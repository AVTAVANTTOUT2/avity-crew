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
const live = { provenance: 'live' as const };
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';

function failure(
  message: string,
  fallback: NonNullable<ProviderEvent['error']>['kind'] = 'process',
): ProviderEvent[] {
  const error = classifyNativeError(message, fallback);
  return [
    ...(error.kind === 'permission'
      ? [{ type: 'permission' as const, text: message, ...live }]
      : []),
    { type: 'error', error, ...live },
    { type: 'result', success: false, ...live },
  ];
}

export function decodeCodexEvent(value: unknown): ProviderEvent[] {
  const event = object(value);
  if (!event)
    return [{ type: 'unknown', text: 'Codex non-object event', ...live }];
  const type = text(event.type);
  if (type === 'thread.started') {
    const id = text(event.thread_id);
    return id
      ? [{ type: 'session', native_session_id: id, ...live }]
      : failure('Codex thread.started omitted thread_id', 'protocol');
  }
  if (type === 'turn.started') return [];
  if (type === 'turn.completed') {
    const nativeUsage = object(event.usage);
    const usage: NonNullable<ProviderEvent['usage']> = {};
    for (const key of ['input_tokens', 'output_tokens'] as const) {
      const count = nativeUsage?.[key];
      if (typeof count === 'number' && Number.isFinite(count) && count >= 0)
        usage[key] = count;
    }
    return [
      ...(Object.keys(usage).length
        ? [{ type: 'usage' as const, usage, ...live }]
        : []),
      { type: 'result', success: true, ...live },
    ];
  }
  if (type === 'turn.failed' || type === 'error') {
    const diagnostic =
      text(object(event.error)?.message) || text(event.message);
    return failure(
      diagnostic || `Codex ${type} without diagnostic`,
      diagnostic ? 'process' : 'protocol',
    );
  }
  const item = object(event.item);
  if (
    ['item.started', 'item.updated', 'item.completed'].includes(type) &&
    item
  ) {
    const itemType = text(item.type);
    const completed = type === 'item.completed';
    if (itemType === 'agent_message')
      return completed && typeof item.text === 'string'
        ? [{ type: 'text', text: item.text, ...live }]
        : [];
    if (itemType === 'reasoning') return [];
    if (itemType === 'error')
      return failure(
        text(item.message) || 'Codex item error without diagnostic',
        text(item.message) ? 'process' : 'protocol',
      );
    const label = `${itemType} ${text(item.id)} (${text(item.status) || type})`;
    let detail: string;
    switch (itemType) {
      case 'command_execution':
        detail = `${text(item.command)}\nexit_code: ${typeof item.exit_code === 'number' ? item.exit_code : 'unavailable'}\n${text(item.aggregated_output)}`;
        break;
      case 'file_change':
        detail = JSON.stringify(item.changes ?? []);
        break;
      case 'mcp_tool_call':
        detail = `${text(item.server)}.${text(item.tool)}\n${JSON.stringify(item.result ?? item.error ?? null)}`;
        break;
      case 'web_search':
        detail = text(item.query);
        break;
      case 'todo_list':
        detail = JSON.stringify(item.items ?? []);
        break;
      default:
        return [{ type: 'unknown', text: `Unhandled Codex ${label}`, ...live }];
    }
    const normalized: ProviderEvent[] = [
      { type: 'tool', text: `${label}\n${detail}`, ...live },
    ];
    if (
      completed &&
      itemType === 'command_execution' &&
      (item.status === 'failed' ||
        (typeof item.exit_code === 'number' && item.exit_code !== 0)) &&
      /permission denied|operation not permitted|approval (?:required|denied)|sandbox.*(?:denied|blocked)/i.test(
        text(item.aggregated_output),
      )
    )
      normalized.push(...failure(text(item.aggregated_output)));
    return normalized;
  }
  return [
    {
      type: 'unknown',
      text: `Unhandled Codex event ${type || '(missing type)'}`,
      ...live,
    },
  ];
}

function argumentsFor(request: ProviderRequest, sessionId?: string): string[] {
  validateProviderRequest(request);
  const args = ['exec', ...(sessionId ? ['resume'] : [])];
  args.push(
    '--ignore-user-config',
    '--json',
    '--skip-git-repo-check',
    '-c',
    `sandbox_mode=${JSON.stringify(request.permissions.sandbox)}`,
    '-c',
    `approval_policy=${JSON.stringify(request.permissions.approval)}`,
  );
  if (request.model !== null) args.push('--model', request.model);
  if (request.bridge) {
    const bridge = request.bridge;
    for (const [key, value] of Object.entries({
      command: bridge.command,
      args: bridge.args,
      env_vars: Object.keys(bridge.env),
      required: true,
    }))
      args.push('-c', `mcp_servers.crew.${key}=${JSON.stringify(value)}`);
  }
  if (sessionId) args.push(sessionId);
  args.push('-');
  return args;
}

export class CodexProvider implements ProviderAdapter {
  readonly id = 'codex' as const;
  constructor(private readonly binary = 'codex') {}

  async probe(): Promise<ProviderCapabilities> {
    const candidates =
      isAbsolute(this.binary) || this.binary.includes('/')
        ? [resolve(this.binary)]
        : (process.env.PATH ?? '')
            .split(delimiter)
            .filter(Boolean)
            .map((dir) => resolve(dir, this.binary));
    let binaryPath: string | undefined;
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK);
        binaryPath = candidate;
        break;
      } catch {
        // Try the next PATH entry.
      }
    }
    if (!binaryPath)
      throw new CrewError(
        'PROVIDER_UNAVAILABLE',
        'Codex executable was not found',
      );
    let outputs: string[];
    try {
      outputs = await Promise.all(
        [['--version'], ['exec', '--help'], ['exec', 'resume', '--help']].map(
          async (args) =>
            (
              await execute(binaryPath, args, {
                timeout: 10_000,
                maxBuffer: 128 * 1024,
              })
            ).stdout,
        ),
      );
    } catch {
      throw new CrewError('PROVIDER_UNAVAILABLE', 'Cannot probe Codex CLI');
    }
    const version =
      outputs[0]?.trim().replace(/^codex-cli\s+/, '') || 'unknown';
    const capability = (supported: boolean, note: string) => ({
      status: supported ? ('supported' as const) : ('unverified' as const),
      evidence_ref: supported ? `codex:${version}:exec-help` : null,
      note,
    });
    const unsupported = (note: string) => ({
      status: 'unsupported' as const,
      evidence_ref: null,
      note,
    });
    return {
      schema_version: 1,
      provider: this.id,
      binary_path: binaryPath,
      version,
      checked_at: now(),
      native_resume: capability(
        outputs[2]?.includes('[SESSION_ID]') === true,
        'Explicit session ID and new stdin prompt',
      ),
      structured_events: capability(
        outputs[1]?.includes('--json') === true,
        'JSONL exec events',
      ),
      mid_turn_input: unsupported(
        'Exec accepts one stdin prompt; finish or interrupt, then resume the exact session',
      ),
      permission_requests: unsupported(
        'Exec has no interactive approval response transport; denials are surfaced',
      ),
      mcp_tools: capability(
        version === '0.163.0',
        'Per-session stdio MCP via config overrides; verified version only',
      ),
      usage_reporting: capability(
        version === '0.163.0',
        'Native token counts only; monetary cost unavailable',
      ),
    };
  }

  start(request: ProviderRequest): ProviderProcess {
    return runNative(
      this.id,
      this.binary,
      argumentsFor(request),
      request,
      decodeCodexEvent,
    );
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
        'Codex resume requires an explicit native session UUID',
      );
    return runNative(
      this.id,
      this.binary,
      argumentsFor(request, request.native_session_id),
      request,
      decodeCodexEvent,
    );
  }
}
