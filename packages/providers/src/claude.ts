import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CrewError, now } from '../../contracts/src/index.ts';
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderEvent,
  ProviderProcess,
  ProviderRequest,
} from '../../contracts/src/index.ts';
import {
  classifyNativeError,
  runNative,
  validateProviderRequest,
} from './process.ts';

const execute = promisify(execFile);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function decodeClaudeEvent(value: unknown): ProviderEvent[] {
  const event = record(value);
  const events: ProviderEvent[] = [];
  const emit = (item: Omit<ProviderEvent, 'provenance'>): void => {
    events.push({ ...item, provenance: 'live' });
  };
  if (typeof event.session_id === 'string')
    emit({ type: 'session', native_session_id: event.session_id });
  if (event.type === 'assistant' || event.type === 'user') {
    if (typeof event.error === 'string')
      emit({ type: 'error', error: classifyNativeError(event.error) });
    const content = record(event.message).content;
    if (Array.isArray(content)) {
      for (const raw of content) {
        const block = record(raw);
        if (
          event.type === 'assistant' &&
          block.type === 'text' &&
          typeof block.text === 'string'
        )
          emit({ type: 'text', text: block.text });
        else if (block.type === 'tool_use' || block.type === 'tool_result')
          emit({ type: 'tool', text: JSON.stringify(block) });
        else emit({ type: 'unknown', text: JSON.stringify(block) });
      }
    }
  } else if (event.type === 'result') {
    const denied =
      Array.isArray(event.permission_denials) &&
      event.permission_denials.length > 0;
    if (denied) {
      emit({
        type: 'permission',
        text: JSON.stringify(event.permission_denials),
      });
      emit({
        type: 'error',
        error: {
          kind: 'permission',
          message: 'Claude Code denied one or more requested tools',
        },
      });
    } else if (event.is_error === true)
      emit({
        type: 'error',
        error: classifyNativeError(
          Array.isArray(event.errors)
            ? event.errors.join('\n')
            : String(
                event.result ??
                  event.subtype ??
                  'Claude Code reported an error',
              ),
        ),
      });
    const usage = record(event.usage);
    const input = usage.input_tokens;
    const output = usage.output_tokens;
    const cost = event.total_cost_usd;
    if (
      [input, output, cost].some(
        (value) => typeof value === 'number' && Number.isFinite(value),
      )
    )
      emit({
        type: 'usage',
        usage: {
          ...(typeof input === 'number' && Number.isFinite(input)
            ? { input_tokens: input }
            : {}),
          ...(typeof output === 'number' && Number.isFinite(output)
            ? { output_tokens: output }
            : {}),
          ...(typeof cost === 'number' && Number.isFinite(cost)
            ? { cost_usd: cost }
            : {}),
        },
      });
    emit({
      type: 'result',
      success: event.is_error === false && !denied,
      ...(typeof event.result === 'string' ? { text: event.result } : {}),
    });
  } else if (event.type === 'system' && event.subtype === 'permission_denied') {
    emit({ type: 'permission', text: JSON.stringify(event) });
    emit({
      type: 'error',
      error: {
        kind: 'permission',
        message: 'Claude Code denied a requested tool',
      },
    });
  } else if (event.type === 'error') {
    emit({
      type: 'error',
      error: classifyNativeError(JSON.stringify(event.error ?? event)),
    });
  } else
    emit({ type: 'unknown', text: JSON.stringify(value) ?? String(value) });
  return events;
}

export class ClaudeProvider implements ProviderAdapter {
  readonly id = 'claude' as const;
  constructor(private readonly binary = 'claude') {}

  async probe(): Promise<ProviderCapabilities> {
    let binaryPath: string | undefined;
    const candidates =
      isAbsolute(this.binary) || this.binary.includes('/')
        ? [resolve(this.binary)]
        : (process.env.PATH ?? '')
            .split(delimiter)
            .map((directory) => resolve(directory, this.binary));
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK);
        binaryPath = candidate;
        break;
      } catch {
        /* Try the next PATH entry. */
      }
    }
    if (!binaryPath)
      throw new CrewError(
        'PROVIDER_UNAVAILABLE',
        `Claude Code binary is not executable: ${this.binary}`,
      );
    let version: string;
    let help: string;
    try {
      const [versionResult, helpResult] = await Promise.all([
        execute(binaryPath, ['--version'], {
          timeout: 10_000,
          maxBuffer: 128 * 1024,
        }),
        execute(binaryPath, ['--help'], {
          timeout: 10_000,
          maxBuffer: 128 * 1024,
        }),
      ]);
      version = versionResult.stdout.trim();
      help = helpResult.stdout;
    } catch (failure) {
      throw new CrewError(
        'PROVIDER_UNAVAILABLE',
        `Cannot inspect Claude Code: ${String(failure)}`,
      );
    }
    const verified = /^2\.1\.304\b/.test(version);
    const capability = (flags: string[]) => ({
      status: flags.every((flag) => help.includes(flag))
        ? verified
          ? ('supported' as const)
          : ('unverified' as const)
        : ('unsupported' as const),
      evidence_ref: `claude:${version}:local-help`,
      note: verified
        ? 'Protocol verified with Claude Code 2.1.304; probe itself performs no paid turn'
        : 'Installed version differs from the live-tested protocol; verify before relying on it',
    });
    return {
      schema_version: 1,
      provider: this.id,
      binary_path: binaryPath,
      version,
      checked_at: now(),
      native_resume: capability(['--resume']),
      structured_events: capability(['--output-format', 'stream-json']),
      mid_turn_input: {
        status: 'unsupported',
        evidence_ref: null,
        note: 'This adapter queues updates between turns; the supervisor resumes the exact session',
      },
      permission_requests: capability(['--permission-prompts']),
      mcp_tools: capability(['--mcp-config', '--strict-mcp-config']),
      usage_reporting: capability(['--output-format']),
    };
  }

  start(request: ProviderRequest): ProviderProcess {
    return this.launch(request);
  }

  resume(
    request: ProviderRequest & { native_session_id: string },
  ): ProviderProcess {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        request.native_session_id,
      )
    )
      throw new CrewError(
        'INVALID_INPUT',
        'Claude resume requires an exact native session UUID',
      );
    return this.launch(request, request.native_session_id);
  }

  private launch(
    request: ProviderRequest,
    nativeSessionId?: string,
  ): ProviderProcess {
    validateProviderRequest(request);
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-prompts',
      'none',
      '--permission-mode',
      request.permissions.sandbox === 'read-only' ? 'dontAsk' : 'acceptEdits',
      '--strict-mcp-config',
      '--mcp-config',
      JSON.stringify({
        mcpServers: request.bridge
          ? {
              crew: {
                command: request.bridge.command,
                args: request.bridge.args,
                env: Object.fromEntries(
                  Object.keys(request.bridge.env).map((key) => [
                    key,
                    '${' + key + '}',
                  ]),
                ),
              },
            }
          : {},
      }),
    ];
    if (request.permissions.sandbox === 'read-only')
      args.push('--tools', 'Read,Glob,Grep');
    if (request.bridge) args.push('--allowedTools', 'mcp__crew__*');
    if (request.model !== null) args.push('--model', request.model);
    if (nativeSessionId) args.push('--resume', nativeSessionId);
    return runNative(this.id, this.binary, args, request, decodeClaudeEvent);
  }
}
