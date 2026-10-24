import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CrewError, now } from '../packages/contracts/src/index.ts';
import type {
  AgentSession,
  ArtifactRef,
  ContextBundle,
  CrewEvent,
  Delegation,
  Handoff,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderEvent,
  ProviderProcess,
  ProviderRequest,
  ProviderResult,
  Review,
  Run,
  TaskSpec,
  TaskState,
  ToolCall,
  Verification,
} from '../packages/contracts/src/index.ts';
import { identifyProject, Store } from '../packages/storage/src/index.ts';
import { SupervisorRuntime } from '../packages/supervisor/src/runtime.ts';
import { SupervisorClient } from '../packages/supervisor/src/client.ts';
import { startTransport } from '../packages/supervisor/src/transport.ts';

type Reply<T> = { result: T; run_version: number };
type Status = {
  run: Run;
  tasks: TaskState[];
  events: CrewEvent[];
  verifications: Verification[];
};
type Collected = {
  handoff: Handoff;
  verifications: Verification[];
  reviews: Review[];
  evidence: (ArtifactRef & { content_excerpt: string; truncated: boolean })[];
};
type Turn = { request: ProviderRequest; nativeId: string; resumed: boolean };
const hasCode = (expected: string) => (error: unknown) =>
  error instanceof CrewError && error.code === expected;
const digest = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

/** Scripted decisions only: HTTP, filesystem, SQLite, scheduler and verification stay real. */
class ScriptedProvider implements ProviderAdapter {
  readonly id = 'fake' as const;
  readonly turns: Turn[] = [];
  readonly failures: unknown[] = [];
  active = 0;
  peak = 0;
  private sequence = 0;
  constructor(private readonly script: (turn: Turn) => Promise<void>) {}

  async probe(): Promise<ProviderCapabilities> {
    const supported = {
      status: 'supported' as const,
      evidence_ref: 'simulated:runtime-test',
      note: 'Scripted test capability, never live provider evidence',
    };
    const unsupported = {
      status: 'unsupported' as const,
      evidence_ref: null,
      note: 'Not implemented by scripted test provider',
    };
    return {
      schema_version: 1,
      provider: 'fake',
      binary_path: 'simulated:in-process',
      version: 'runtime-test:1',
      checked_at: now(),
      native_resume: supported,
      structured_events: supported,
      mid_turn_input: unsupported,
      permission_requests: unsupported,
      mcp_tools: supported,
      usage_reporting: unsupported,
    };
  }

  start(request: ProviderRequest): ProviderProcess {
    return this.launch({
      request,
      nativeId: `simulated:conversation-${++this.sequence}`,
      resumed: false,
    });
  }
  resume(
    request: ProviderRequest & { native_session_id: string },
  ): ProviderProcess {
    return this.launch({
      request,
      nativeId: request.native_session_id,
      resumed: true,
    });
  }
  private launch(turn: Turn): ProviderProcess {
    this.turns.push(turn);
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    let finish!: (value: ProviderResult) => void;
    const result = new Promise<ProviderResult>((resolve) => {
      finish = resolve;
    });
    let stopped = false;
    const provider = this;
    const value = (error: ProviderResult['error'] = null): ProviderResult => ({
      provider: 'fake',
      provenance: 'simulated',
      native_session_id: turn.nativeId,
      exit_code: stopped ? null : error ? 1 : 0,
      signal: stopped ? 'SIGINT' : null,
      success: !stopped && !error,
      text: 'Scripted runtime test completed; no live provider was used',
      error,
    });
    return {
      pid: null,
      events: (async function* (): AsyncGenerator<ProviderEvent> {
        let failure: ProviderResult['error'] = null;
        try {
          yield {
            type: 'session',
            native_session_id: turn.nativeId,
            provenance: 'simulated',
          };
          await provider.script(turn);
          yield { type: 'result', success: !stopped, provenance: 'simulated' };
        } catch (error) {
          provider.failures.push(error);
          failure = {
            kind: 'protocol',
            message: 'Scripted test assertion or HTTP action failed',
          };
          yield { type: 'error', error: failure, provenance: 'simulated' };
        } finally {
          provider.active--;
          finish(value(failure));
        }
      })(),
      result,
      send: async () => {
        throw new CrewError(
          'UNSUPPORTED',
          'Scripted turns cannot receive mid-turn updates',
        );
      },
      interrupt: async () => {
        stopped = true;
        finish(value());
      },
      stop: async () => {
        stopped = true;
        finish(value());
      },
    };
  }
}

/** The simulated agent receives only its launch request and authenticated HTTP client. */
function agent(request: ProviderRequest) {
  const env = request.bridge?.env;
  assert.ok(env);
  const runId = env.AVITY_CREW_RUN_ID!;
  const client = new SupervisorClient({
    endpointFile: env.AVITY_CREW_ENDPOINT_FILE!,
    capability: env.AVITY_CREW_CAPABILITY!,
  });
  let sequence = 0;
  const envelope = (
    method: ToolCall['method'],
    args: unknown,
    expectedVersion: number,
  ): ToolCall =>
    ({
      schema_version: 1,
      request_id: `script:request-${++sequence}`,
      idempotency_key: `script:key-${digest(env.AVITY_CREW_CAPABILITY!).slice(0, 16)}-${sequence}`,
      run_id: runId,
      expected_version: expectedVersion,
      method,
      arguments: args,
    }) as ToolCall;
  const status = async (taskId: string | null = null) =>
    client.execute(
      envelope('get_status', { after_seq: 0, limit: 200, task_id: taskId }, 0),
    ) as Promise<Reply<Status>>;
  const call = async <T>(
    method: ToolCall['method'],
    args: unknown,
  ): Promise<Reply<T>> => {
    const current = await status();
    return client.execute(
      envelope(method, args, current.run_version),
    ) as Promise<Reply<T>>;
  };
  return { client, runId, status, call };
}

async function fixture(
  t: TestContext,
  provider: ScriptedProvider,
  maximum = 1,
) {
  const directory = mkdtempSync(join(tmpdir(), 'crew runtime simulated '));
  const root = join(directory, 'project with spaces');
  mkdirSync(root);
  const project = identifyProject(root, join(directory, 'private data'));
  project.config.max_active_agents = maximum;
  const store = new Store(project);
  const runtime = new SupervisorRuntime(
    store,
    join(project.data_dir, 'endpoint.json'),
    [provider],
  );
  const transport = await startTransport({
    directory: project.data_dir,
    project_id: project.id,
    registry: runtime.registry,
    api: runtime.coordinator,
  });
  const owner = new SupervisorClient({
    endpointFile: transport.endpointFile,
    capability: readFileSync(runtime.registry.ownerKeyPath, 'utf8'),
  });
  t.after(async () => {
    await runtime.close();
    await transport.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const create = async () =>
    owner.admin({
      method: 'create_run',
      arguments: {
        objective:
          'Produce and independently review a real document through the local protocol',
        criteria: [
          'A captured document is independently reviewed and verified',
        ],
        constraints: [],
        chief_provider: 'fake',
        chief_model: null,
        max_active_agents: maximum,
        delivery_mode: 'documentation',
      },
    }) as Promise<Run>;
  const completed = async (runId: string) => {
    const deadline = Date.now() + 10_000;
    let status: Record<string, unknown> | undefined;
    while (Date.now() < deadline) {
      if (provider.failures.length) throw provider.failures[0];
      status = (await owner.admin({
        method: 'status',
        arguments: { run_id: runId, limit: 1000 },
      })) as Record<string, unknown>;
      const run = status.run as Run;
      if (run.status === 'completed') {
        await runtime.scheduler.idle();
        return status;
      }
      const failures = (status.events as CrewEvent[]).filter((event) =>
        ['turn.launch_failed', 'scheduler.blocked'].includes(event.type),
      );
      assert.deepEqual(
        failures.map((event) => event.payload),
        [],
        'Runtime must not silently drop a provider launch',
      );
      await delay(10);
    }
    assert.fail(
      `Simulated runtime did not complete: ${JSON.stringify(status)}`,
    );
  };
  return {
    directory,
    root,
    project,
    store,
    runtime,
    transport,
    owner,
    create,
    completed,
  };
}

function task(run: Run, id: string, role: 'documenter' | 'reviewer'): TaskSpec {
  return {
    schema_version: 1,
    id,
    run_id: run.id,
    title: id,
    objective:
      role === 'reviewer'
        ? 'Read the captured delivery and observed checks; submit an independent documentation review'
        : 'Write docs/livrable.md with the required text',
    role,
    acceptance_criteria: [run.acceptance_criteria[0]!],
    depends_on: [],
    scope: {
      read_paths: ['docs/'],
      write_paths: role === 'reviewer' ? [] : ['docs/'],
      excluded_paths: [],
    },
    base_revision: null,
    context_source_ids: [],
    expected_deliverables: [
      role === 'reviewer' ? 'Independent review record' : 'docs/livrable.md',
    ],
    created_at: now(),
  };
}

test(
  'simulated provider completes real HTTP/SQLite document orchestration with one slot and native conversation resume',
  { timeout: 20_000 },
  async (t) => {
    const content =
      '# Livrable\n\nDocument réel produit pour le scénario simulé.\n';
    let chiefTurns = 0;
    const sequence: string[] = [];
    const provider = new ScriptedProvider(async ({ request }) => {
      const api = agent(request);
      const current = (await api.status()).result;
      const own = current.tasks[0];
      if (request.role === 'chief') {
        sequence.push(`chief:${++chiefTurns}`);
        assert.equal(current.run.status, 'running');
        if (chiefTurns === 1) {
          assert.deepEqual(
            current.tasks,
            [],
            'The chief is outside the deliverable DAG',
          );
          await assert.rejects(
            api.call('finish_run', {
              summary: 'A native success is not evidence',
              criterion_evidence: [
                {
                  criterion_id: current.run.acceptance_criteria[0]!.id,
                  evidence_artifact_ids: ['artifact:absent'],
                },
              ],
              delivered_artifact_ids: ['artifact:absent'],
            }),
            hasCode('INVALID_EVIDENCE'),
          );
          const spec = task(current.run, 'task:document', 'documenter');
          await api.call('create_task', { task: spec });
          const delegated = (
            await api.call<Delegation>('delegate_task', {
              task_id: spec.id,
              provider: 'fake',
              model: null,
            })
          ).result;
          assert.equal(delegated.status, 'queued');
          assert.equal(delegated.attempt_id, null);
          const after = (await api.status()).result;
          assert.equal(
            after.tasks[0]!.active_attempt_id,
            null,
            'Delegation returns before a slot or worker is available',
          );
        } else if (chiefTurns === 2) {
          const delivery = (
            await api.call<Collected>('collect_delivery', {
              task_id: 'task:document',
              handoff_id: null,
            })
          ).result;
          assert.equal(
            current.tasks.find((item) => item.id === 'task:document')!.status,
            'in_review',
            'A successful writer exit cannot accept the task',
          );
          assert.ok(
            delivery.verifications.some(
              (proof) => proof.result === 'passed' && proof.exit_code === 0,
            ),
          );
          const spec = task(current.run, 'task:review', 'reviewer');
          assert.deepEqual(
            spec.depends_on,
            [],
            'A review must not await acceptance of its own target',
          );
          await api.call('create_task', { task: spec });
          assert.equal(
            (
              await api.call<Delegation>('delegate_task', {
                task_id: spec.id,
                provider: 'fake',
                model: null,
              })
            ).result.status,
            'queued',
          );
        } else if (chiefTurns === 3) {
          const delivery = (
            await api.call<Collected>('collect_delivery', {
              task_id: 'task:document',
              handoff_id: null,
            })
          ).result;
          const review = delivery.reviews[0]!;
          const accepted = (
            await api.call<TaskState>('accept_delivery', {
              handoff_id: delivery.handoff.id,
              review_ids: [review.id],
              verification_ids: delivery.verifications.map((proof) => proof.id),
              accepted_revision: delivery.handoff.source_revision,
            })
          ).result;
          assert.equal(accepted.status, 'accepted');
          assert.equal(
            accepted.accepted_revision,
            delivery.handoff.source_revision,
          );
          const proof = delivery.verifications.find(
            (item) => item.result === 'passed',
          )!;
          const final = (
            await api.call<Run>('finish_run', {
              summary:
                'Captured document reviewed and verified; provider reasoning was simulated',
              criterion_evidence: proof.criterion_ids.map((id) => ({
                criterion_id: id,
                evidence_artifact_ids: proof.evidence_artifact_ids,
              })),
              delivered_artifact_ids: delivery.handoff.artifacts.map(
                (item) => item.id,
              ),
            })
          ).result;
          assert.equal(final.status, 'completed');
        } else assert.fail('Unexpected extra chief turn');
        return;
      }
      assert.ok(own);
      assert.equal(own.spec.role, request.role);
      const context = (
        await api.call<{ context: ContextBundle }>('read_context', {
          subject_id: own.id,
          source_ids: [],
          after_version: 0,
        })
      ).result.context;
      assert.equal(context.subject_kind, 'task');
      assert.equal(context.subject_id, own.id);
      assert.equal(context.content_sha256, digest(request.prompt));
      assert.ok(request.prompt.includes(request.cwd));
      if (request.role === 'documenter') {
        sequence.push('documenter');
        mkdirSync(join(request.cwd, 'docs'), { recursive: true });
        writeFileSync(join(request.cwd, 'docs/livrable.md'), content);
        const declared: Handoff = {
          schema_version: 1,
          id: 'handoff:document',
          task_id: own.id,
          run_id: api.runId,
          attempt_id: own.active_attempt_id!,
          generation: own.generation,
          status: 'delivered',
          summary: 'A real document file is ready to capture',
          source_revision: null,
          artifacts: [
            {
              id: 'artifact:model-declared',
              kind: 'file',
              reference: 'docs/livrable.md',
              revision: `sha256:${'0'.repeat(64)}`,
              producer_attempt_id: own.active_attempt_id!,
              created_at: now(),
            },
          ],
          verifications: [],
          criteria_claimed: own.spec.acceptance_criteria.map((item) => item.id),
          limitations: [],
          next_information: [],
          created_at: now(),
        };
        const captured = (
          await api.call<Handoff>('submit_handoff', { handoff: declared })
        ).result;
        assert.match(captured.source_revision!, /^sha256:[a-f0-9]{64}$/);
        const file = captured.artifacts.find((item) => item.kind === 'file')!;
        assert.equal(file.revision, `sha256:${digest(content)}`);
        assert.notEqual(file.id, declared.artifacts[0]!.id);
        assert.match(file.reference, /^artifacts\//);
        assert.equal((await api.status()).result.tasks[0]!.status, 'in_review');
      } else if (request.role === 'reviewer') {
        sequence.push('reviewer');
        assert.equal(request.permissions.sandbox, 'read-only');
        const delivery = (
          await api.call<Collected>('collect_delivery', {
            task_id: 'task:document',
            handoff_id: null,
          })
        ).result;
        assert.equal(
          delivery.evidence.find((item) => item.kind === 'file')!
            .content_excerpt,
          content,
        );
        assert.ok(delivery.verifications.length);
        assert.ok(
          delivery.verifications.every(
            (proof) =>
              proof.mode === 'static' &&
              proof.result === 'passed' &&
              proof.tested_revision === delivery.handoff.source_revision &&
              proof.execution === 'automated' &&
              proof.exit_code === 0 &&
              proof.evidence_artifact_ids.length > 0,
          ),
        );
        const review: Review = {
          schema_version: 1,
          id: 'review:document',
          run_id: api.runId,
          review_task_id: own.id,
          review_of_task_id: delivery.handoff.task_id,
          handoff_id: delivery.handoff.id,
          outcome: 'approved',
          verification_scope: 'documentation',
          source_revision: delivery.handoff.source_revision!,
          tested_revision: delivery.handoff.source_revision,
          summary: 'Read exact immutable document and service-observed checks',
          findings: [],
          verification_ids: delivery.verifications.map((proof) => proof.id),
          created_at: now(),
        };
        await api.call('submit_review', { review });
      } else assert.fail(`Unexpected scripted role ${request.role}`);
    });
    const f = await fixture(t, provider);
    const run = await f.create();
    await f.completed(run.id);
    assert.deepEqual(sequence, [
      'chief:1',
      'documenter',
      'chief:2',
      'reviewer',
      'chief:3',
    ]);
    assert.equal(provider.peak, 1);
    assert.equal(provider.active, 0);
    assert.deepEqual(provider.failures, []);
    const chief = provider.turns.filter(
      (turn) => turn.request.role === 'chief',
    );
    assert.deepEqual(
      chief.map((turn) => turn.resumed),
      [false, true, true],
    );
    assert.equal(new Set(chief.map((turn) => turn.nativeId)).size, 1);
    assert.equal(
      readFileSync(join(f.root, 'docs/livrable.md'), 'utf8'),
      content,
    );
    assert.equal(existsSync(join(f.root, '.git')), false);
    assert.equal(f.store.getRun(run.id).status, 'completed');
    assert.ok(
      f.store.tasks(run.id).every((item) => item.status === 'accepted'),
    );
    assert.equal(f.store.tasks(run.id).length, 2);
    const contexts = f.store.records<ContextBundle>(run.id, 'context');
    const events = f.store.events(run.id, 0, 1000);
    const compiled = events.filter(
      (event) => event.type === 'context.compiled',
    );
    assert.equal(compiled.length, provider.turns.length);
    for (const [index, event] of compiled.entries()) {
      const request = provider.turns[index]!.request;
      const payload = event.payload as Record<string, unknown>;
      const ref = payload.prompt as {
        reference: string;
        revision: string;
      };
      assert.equal(ref.revision, `sha256:${digest(request.prompt)}`);
      assert.equal(f.store.readArtifact(ref).toString('utf8'), request.prompt);
      assert.equal(
        contexts.find((bundle) => bundle.id === payload.context_id)!
          .content_sha256,
        digest(request.prompt),
      );
      assert.equal(
        request.prompt.includes(request.bridge!.env.AVITY_CREW_CAPABILITY!),
        false,
      );
    }
    const sessions = f.store.records<AgentSession>(run.id, 'session');
    for (const turn of provider.turns)
      assert.ok(
        sessions.some(
          (session) =>
            session.native_session_id === turn.nativeId &&
            session.cwd === turn.request.cwd,
        ),
      );
    const providerEvents = events.filter((event) =>
      event.type.startsWith('provider.'),
    );
    assert.ok(providerEvents.length);
    assert.ok(
      providerEvents.every(
        (event) =>
          (event.payload as Record<string, unknown>).provenance === 'simulated',
      ),
    );
    assert.equal(f.store.records(run.id, 'final').length, 1);
  },
);
