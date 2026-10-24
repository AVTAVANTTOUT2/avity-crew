import { CrewError, now } from '../../contracts/src/index.ts';
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderEvent,
  ProviderProcess,
  ProviderRequest,
} from '../../contracts/src/index.ts';

export class FakeProvider implements ProviderAdapter {
  readonly id = 'fake' as const;
  constructor(
    private readonly script: readonly ProviderEvent[] = [
      { type: 'result', success: true, provenance: 'simulated' },
    ],
  ) {}

  async probe(): Promise<ProviderCapabilities> {
    const supported = {
      status: 'supported' as const,
      evidence_ref: 'fake:deterministic',
      note: 'Simulation only',
    };
    const unsupported = {
      status: 'unsupported' as const,
      evidence_ref: null,
      note: 'Not a native provider',
    };
    return {
      schema_version: 1,
      provider: 'fake',
      binary_path: 'fake',
      version: '1',
      checked_at: now(),
      native_resume: unsupported,
      structured_events: supported,
      mid_turn_input: unsupported,
      permission_requests: unsupported,
      mcp_tools: unsupported,
      usage_reporting: unsupported,
    };
  }

  start(_request: ProviderRequest): ProviderProcess {
    let interrupted = false;
    const script = this.script;
    return {
      pid: null,
      events: (async function* () {
        for (const event of script) {
          if (interrupted) break;
          yield { ...event, provenance: 'simulated' as const };
        }
      })(),
      result: Promise.resolve().then(() => ({
        provider: 'fake',
        provenance: 'simulated',
        native_session_id: null,
        exit_code: interrupted ? null : 0,
        signal: interrupted ? 'SIGINT' : null,
        success:
          !interrupted &&
          script.findLast((e) => e.type === 'result')?.success === true &&
          !script.some((e) => e.type === 'error'),
        text: interrupted
          ? ''
          : script
              .filter((e) => e.type === 'text')
              .map((e) => e.text ?? '')
              .join(''),
        error: script.find((e) => e.type === 'error')?.error ?? null,
      })),
      send: async () => 'queued',
      interrupt: async () => {
        interrupted = true;
      },
      stop: async () => {
        interrupted = true;
      },
    };
  }

  resume(
    _request: ProviderRequest & { native_session_id: string },
  ): ProviderProcess {
    throw new CrewError(
      'UNSUPPORTED',
      'Fake provider has no native conversation to resume',
    );
  }
}
