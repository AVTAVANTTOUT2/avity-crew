import { CrewError, now } from '../../contracts/src/index.ts';
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderEvent,
  ProviderProcess,
  ProviderRequest,
  ProviderResult,
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
    let complete!: (result: ProviderResult) => void;
    const result = new Promise<ProviderResult>((resolve) => {
      complete = resolve;
    });
    let text = '';
    let success = false;
    let nativeSessionId: string | null = null;
    let error: ProviderResult['error'] = null;
    const finish = (signal: string | null): void =>
      complete({
        provider: 'fake',
        provenance: 'simulated',
        native_session_id: nativeSessionId,
        exit_code: signal ? null : 0,
        signal,
        success: !signal && success && !error,
        text,
        error,
      });
    return {
      pid: null,
      events: (async function* () {
        let exhausted = false;
        try {
          for (const event of script) {
            if (interrupted) break;
            if (event.type === 'text') text += event.text ?? '';
            if (event.type === 'session')
              nativeSessionId = event.native_session_id ?? null;
            if (event.type === 'error')
              error = event.error ?? {
                kind: 'protocol',
                message: 'Simulated provider error without details',
              };
            if (event.type === 'result') success = event.success === true;
            yield { ...event, provenance: 'simulated' as const };
          }
          exhausted = !interrupted;
        } finally {
          finish(exhausted ? null : 'SIGINT');
        }
      })(),
      result,
      send: async () => {
        throw new CrewError(
          'UNSUPPORTED',
          'Fake provider cannot receive input during a turn',
        );
      },
      interrupt: async () => {
        interrupted = true;
        finish('SIGINT');
      },
      stop: async () => {
        interrupted = true;
        finish('SIGTERM');
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
