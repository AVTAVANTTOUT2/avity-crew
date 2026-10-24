import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import { CrewError, runtimeSchema } from '../../contracts/src/index.ts';
import type {
  ProviderEvent,
  ProviderProcess,
  ProviderRequest,
  ProviderResult,
} from '../../contracts/src/index.ts';

export type NativeDecoder = (event: unknown) => ProviderEvent[];
type NativeError = NonNullable<ProviderEvent['error']>;
const MAX_LINE = 1024 * 1024;
const MAX_TEXT = 2 * MAX_LINE;
const MAX_DIAGNOSTIC = 16 * 1024;
const MAX_QUEUE = 128;
const crewMethods = new Set<string>(
  runtimeSchema.$defs.ToolCall.oneOf.map(
    (entry) => entry.properties.method.const,
  ),
);

export function validateProviderRequest(request: ProviderRequest): void {
  const valid =
    request &&
    typeof request.cwd === 'string' &&
    isAbsolute(request.cwd) &&
    typeof request.prompt === 'string' &&
    request.prompt.trim() !== '' &&
    (request.model === null ||
      (typeof request.model === 'string' && request.model.trim() !== '')) &&
    ['read-only', 'workspace-write'].includes(request.permissions?.sandbox) &&
    ['never', 'on-request'].includes(request.permissions?.approval) &&
    (!request.bridge ||
      (typeof request.bridge.command === 'string' &&
        request.bridge.command.trim() !== '' &&
        Array.isArray(request.bridge.args) &&
        request.bridge.args.every((arg) => typeof arg === 'string') &&
        request.bridge.env !== null &&
        typeof request.bridge.env === 'object' &&
        !Array.isArray(request.bridge.env) &&
        Object.entries(request.bridge.env).every(
          ([key, value]) =>
            key !== '' && !key.includes('=') && typeof value === 'string',
        )));
  if (!valid)
    throw new CrewError('INVALID_INPUT', 'Invalid native provider request');
  const approved = request.bridge?.approved_tools;
  if (
    approved !== undefined &&
    (!Array.isArray(approved) ||
      new Set(approved).size !== approved.length ||
      [...approved].some(
        (method) => typeof method !== 'string' || !crewMethods.has(method),
      ))
  )
    throw new CrewError(
      'INVALID_INPUT',
      'Bridge approved_tools must list distinct canonical crew methods',
    );
}

export function classifyNativeError(
  message: string,
  fallback: NativeError['kind'] = 'process',
): NativeError {
  const kind = /quota|rate.?limit|429|credits?|usage limit/i.test(message)
    ? 'quota'
    : /authentication|unauthorized|not logged|log.?in|invalid.{0,20}(key|token)|401/i.test(
          message,
        )
      ? 'authentication'
      : /permission|denied|not allowed|not permitted|EACCES|EPERM|sandbox/i.test(
            message,
          )
        ? 'permission'
        : /network|ECONN|ENOTFOUND|fetch failed|timed? ?out|ETIMEDOUT|connection/i.test(
              message,
            )
          ? 'network'
          : fallback;
  return { kind, message };
}

export function runNative(
  provider: 'claude' | 'codex',
  binary: string,
  args: readonly string[],
  request: ProviderRequest,
  decode: NativeDecoder,
): ProviderProcess {
  validateProviderRequest(request);
  const env = { ...process.env, ...request.bridge?.env };
  const secrets = [
    ...Object.entries(env)
      .filter(([key]) =>
        /TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE|CAPABILITY|AUTH(?:ORIZATION|_SOCK)?$/i.test(
          key,
        ),
      )
      .map(([, value]) => value),
    ...Object.values(request.bridge?.env ?? {}),
  ].filter((value): value is string => Boolean(value));
  const redact = (value: string): string => {
    let clean = value;
    for (const secret of secrets)
      clean = clean.replaceAll(secret, '[REDACTED]');
    return clean
      .replace(/\bBearer\s+[^\s"'\\]+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
  };
  const child = spawn(binary, [...args], {
    cwd: request.cwd,
    env,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let resolveResult!: (value: ProviderResult) => void;
  const result = new Promise<ProviderResult>((resolve) => {
    resolveResult = resolve;
  });
  const queue: ProviderEvent[] = [];
  let wake: (() => void) | undefined;
  let space: (() => void) | undefined;
  let ended = false;
  let abandoned = false;
  let interrupted: NodeJS.Signals | null = null;
  let stopping: Promise<void> | null = null;
  let error: NativeError | null = null;
  let sessionId: string | null = null;
  let text = '';
  let textBytes = 0;
  let hasTerminal = false;
  let nativeSuccess = false;
  let stderr = '';
  const stderrDecoder = new StringDecoder('utf8');
  const publish = async (event: ProviderEvent): Promise<void> => {
    if (event.text !== undefined) {
      event = { ...event, text: redact(event.text) };
      if (
        (event.type === 'unknown' || event.type === 'tool') &&
        Buffer.byteLength(event.text!, 'utf8') > MAX_DIAGNOSTIC
      )
        event.text =
          Buffer.from(event.text!)
            .subarray(0, MAX_DIAGNOSTIC)
            .toString('utf8') + '\n[diagnostic truncated]';
    }
    if (event.error)
      event = {
        ...event,
        error: { ...event.error, message: redact(event.error.message) },
      };
    // Native IDs are protocol keys; masking them would break exact resume.
    if (sessionId) event = { ...event, native_session_id: sessionId };
    while (queue.length >= MAX_QUEUE && !abandoned)
      await new Promise<void>((resolve) => {
        space = resolve;
      });
    if (abandoned) return;
    queue.push({ ...event, provenance: 'live' });
    wake?.();
    wake = undefined;
  };
  const fail = async (failure: NativeError): Promise<void> => {
    error ??= { ...failure, message: redact(failure.message) };
    await publish({ type: 'error', provenance: 'live', error: failure });
  };
  const killTree = (signal: NodeJS.Signals): void => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code !== 'ESRCH')
        error ??= classifyNativeError(redact(String(failure)));
    }
  };
  const terminate = (signal: NodeJS.Signals): Promise<void> => {
    if (ended && !interrupted) return Promise.resolve();
    interrupted ??= signal;
    stopping ??= (async () => {
      killTree(signal);
      await delay(300);
      killTree('SIGTERM');
      await delay(300);
      // The parent may have exited while one of its children ignored SIGTERM.
      killTree('SIGKILL');
      await result;
    })();
    return stopping;
  };
  const accept = async (event: ProviderEvent): Promise<void> => {
    if (event.native_session_id) {
      const expected =
        'native_session_id' in request ? request.native_session_id : null;
      if (
        (sessionId && event.native_session_id !== sessionId) ||
        (expected && event.native_session_id !== expected)
      ) {
        await fail({
          kind: 'protocol',
          message: 'Native provider changed the targeted session identity',
        });
        void terminate('SIGTERM');
        return;
      }
      if (event.type === 'session' && sessionId === event.native_session_id)
        return;
      sessionId = event.native_session_id;
    }
    if (event.type === 'error' || event.error)
      error ??= event.error
        ? { ...event.error, message: redact(event.error.message) }
        : {
            kind: 'process',
            message: 'Native provider reported an error without details',
          };
    if (event.type === 'text') {
      const addedBytes = Buffer.byteLength(event.text ?? '', 'utf8');
      if (textBytes + addedBytes > MAX_TEXT) {
        await fail({
          kind: 'protocol',
          message: 'Native provider text exceeded the 2 MiB limit',
        });
        void terminate('SIGTERM');
        return;
      }
      textBytes += addedBytes;
      text += redact(event.text ?? '');
    }
    if (event.type === 'result') {
      hasTerminal = true;
      nativeSuccess = event.success === true;
      if (event.text !== undefined) {
        if (Buffer.byteLength(event.text, 'utf8') > MAX_TEXT) {
          await fail({
            kind: 'protocol',
            message: 'Native provider result exceeded the 2 MiB limit',
          });
          void terminate('SIGTERM');
        } else text = redact(event.text);
      }
      return;
    }
    await publish(event);
  };
  const acceptLine = async (line: string): Promise<void> => {
    if (!line.trim()) return;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE)
      throw new Error('Native JSONL line exceeded the 1 MiB limit');
    const events = decode(JSON.parse(line));
    for (const event of events) await accept(event);
  };
  let processError: Error | null = null;
  child.on('error', (failure) => {
    processError = failure;
  });
  child.stdin.on('error', (failure) => {
    processError ??= failure;
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = Buffer.from(stderr + stderrDecoder.write(chunk))
      .subarray(-MAX_DIAGNOSTIC)
      .toString('utf8');
  });
  const closed = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
  const output = (async () => {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    try {
      for await (const chunk of child.stdout) {
        pending += decoder.write(chunk as Buffer);
        let newline: number;
        while ((newline = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          await acceptLine(line);
        }
        if (Buffer.byteLength(pending, 'utf8') > MAX_LINE)
          throw new Error('Native JSONL line exceeded the 1 MiB limit');
      }
      pending += decoder.end();
      if (pending) await acceptLine(pending);
    } catch (failure) {
      if (!interrupted) {
        await fail({
          kind: 'protocol',
          message: `Invalid native JSONL: ${String(failure)}`,
        });
        void terminate('SIGTERM');
      }
    }
  })();
  void (async () => {
    const exit = await closed;
    await output;
    stderr += stderrDecoder.end();
    if (stderr.trim())
      await publish({
        type: 'unknown',
        provenance: 'live',
        text: `stderr: ${stderr}`,
      });
    if (processError) await fail(classifyNativeError(String(processError)));
    else if (exit.code !== 0 && !interrupted)
      await fail(
        classifyNativeError(
          stderr ||
            `Native provider exited with code ${exit.code} (${exit.signal ?? 'no signal'})`,
        ),
      );
    else if (!hasTerminal && !interrupted && !error)
      await fail({
        kind: 'protocol',
        message: 'Native provider exited without a terminal result',
      });
    const success = exit.code === 0 && nativeSuccess && !interrupted && !error;
    if (!success && !error)
      error = {
        kind: 'process',
        message: interrupted
          ? `Native provider interrupted with ${interrupted}`
          : 'Native provider reported an unsuccessful result',
      };
    await publish({
      type: 'result',
      provenance: 'live',
      success,
      ...(error ? { error } : {}),
    });
    ended = true;
    wake?.();
    resolveResult({
      provider,
      provenance: 'live',
      native_session_id: sessionId,
      exit_code: exit.code,
      signal: exit.signal ?? interrupted,
      success,
      text,
      error,
    });
  })();
  child.stdin.end(request.prompt);
  return {
    pid: child.pid ?? null,
    result,
    events: (async function* () {
      try {
        while (!ended || queue.length > 0) {
          if (queue.length) {
            const event = queue.shift()!;
            space?.();
            space = undefined;
            yield event;
          } else
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
        }
      } finally {
        abandoned = true;
        space?.();
        if (!ended) void terminate('SIGTERM');
      }
    })(),
    send: async () => {
      throw new CrewError(
        'UNSUPPORTED',
        'Native CLI input during a turn is unsupported; queue the update and resume the exact session',
      );
    },
    interrupt: () => terminate('SIGINT'),
    stop: () => terminate('SIGTERM'),
  };
}
