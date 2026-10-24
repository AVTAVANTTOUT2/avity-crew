import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
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
  Actor,
  ArtifactRef,
  ContextBundle,
  CoordinationQuestion,
  UserResponse,
  Decision,
  CrewEvent,
  Delegation,
  Handoff,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderEvent,
  ProviderProcess,
  ProviderRequest,
  ProviderResult,
  Operation,
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
import {
  requestId,
  serviceActor,
} from '../packages/supervisor/src/coordinator.ts';
import { observeProcess } from '../packages/supervisor/src/reconciliation.ts';
import type { ProcessIdentity } from '../packages/supervisor/src/reconciliation.ts';
import type { IntegrationCandidate } from '../packages/workspace/src/index.ts';

type Reply<T> = { result: T; run_version: number };
type Status = {
  run: Run;
  tasks: TaskState[];
  events: CrewEvent[];
  verifications: Verification[];
  questions: CoordinationQuestion[];
  user_responses: UserResponse[];
};
type Collected = {
  handoff: Handoff;
  verifications: Verification[];
  reviews: Review[];
  evidence: (ArtifactRef & { content_excerpt: string; truncated: boolean })[];
};
type Turn = {
  request: ProviderRequest;
  nativeId: string;
  resumed: boolean;
  signal?: AbortSignal;
};
const hasCode = (expected: string) => (error: unknown) =>
  error instanceof CrewError && error.code === expected;
const deniedCapability = (error: unknown) =>
  error instanceof CrewError &&
  ['REVOKED_CAPABILITY', 'FORBIDDEN'].includes(error.code);
const digest = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).replace(/\r?\n$/, '');

function barrier(count: number) {
  let entered = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    ready,
    enter: () => {
      if (++entered === count) release();
      return ready;
    },
  };
}
async function bounded<T>(pending: Promise<T>, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), 5_000);
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
async function untilInterrupted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true }),
  );
}

/** Lose an actual HTTP reply after the committed action has produced its headers. */
async function discardReply(
  request: ProviderRequest,
  call: ToolCall,
): Promise<void> {
  const env = request.bridge!.env;
  const endpoint = JSON.parse(
    readFileSync(env.AVITY_CREW_ENDPOINT_FILE!, 'utf8'),
  ) as { url: string };
  const body = JSON.stringify(call);
  await new Promise<void>((resolve, reject) => {
    let responseSeen = false;
    const outgoing = httpRequest(new URL('call', endpoint.url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.AVITY_CREW_CAPABILITY!}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    });
    outgoing.once('response', (response) => {
      responseSeen = true;
      assert.equal(response.statusCode, 200);
      response.destroy();
      outgoing.destroy();
      resolve();
    });
    outgoing.once('error', (error) => {
      if (!responseSeen) reject(error);
    });
    outgoing.end(body);
  });
}

/** Scripted decisions only: HTTP, filesystem, SQLite, scheduler and verification stay real. */
class ScriptedProvider implements ProviderAdapter {
  readonly id = 'fake' as const;
  readonly turns: Turn[] = [];
  readonly failures: unknown[] = [];
  active = 0;
  peak = 0;
  private sequence = 0;
  constructor(
    private readonly script: (turn: Turn) => Promise<void>,
    private readonly options: {
      repeatSession?: boolean;
      observeRealProcess?: boolean;
    } = {},
  ) {}

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
    const interruption = new AbortController();
    turn.signal = interruption.signal;
    this.turns.push(turn);
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    let finish!: (value: ProviderResult) => void;
    const result = new Promise<ProviderResult>((resolve) => {
      finish = resolve;
    });
    let stopped = false;
    const provider = this;
    // A disposable Node process exercises real observed_at metadata; decisions stay simulated.
    const identityProcess = this.options.observeRealProcess
      ? spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
          cwd: turn.request.cwd,
          stdio: ['pipe', 'ignore', 'ignore'],
        })
      : undefined;
    const identityEnded = identityProcess
      ? new Promise<void>((resolve, reject) => {
          identityProcess.once('exit', () => resolve());
          identityProcess.once('error', reject);
        })
      : Promise.resolve();
    identityProcess?.stdin?.on('error', () => {});
    const closeIdentity = async (interrupt = false) => {
      if (interrupt && identityProcess?.exitCode === null)
        identityProcess.kill('SIGINT');
      identityProcess?.stdin?.end();
      await identityEnded;
    };
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
      pid: identityProcess?.pid ?? null,
      events: (async function* (): AsyncGenerator<ProviderEvent> {
        let failure: ProviderResult['error'] = null;
        try {
          yield {
            type: 'session',
            native_session_id: turn.nativeId,
            provenance: 'simulated',
          };
          if (provider.options.repeatSession) {
            await delay(5);
            yield {
              type: 'session',
              native_session_id: turn.nativeId,
              provenance: 'simulated',
            };
            yield {
              type: 'text',
              text: 'Simulated hook output before tools',
              provenance: 'simulated',
            };
            await delay(5);
            yield {
              type: 'text',
              text: 'Simulated initialization output before tools',
              provenance: 'simulated',
            };
          }
          if (!stopped) await provider.script(turn);
          yield { type: 'result', success: !stopped, provenance: 'simulated' };
        } catch (error) {
          provider.failures.push(error);
          failure = {
            kind: 'protocol',
            message: 'Scripted test assertion or HTTP action failed',
          };
          yield { type: 'error', error: failure, provenance: 'simulated' };
        } finally {
          await closeIdentity();
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
        interruption.abort();
        await closeIdentity(true);
        finish(value());
      },
      stop: async () => {
        stopped = true;
        interruption.abort();
        await closeIdentity(true);
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
    const action = await prepare(method, args);
    for (let retry = 0; ; retry++) {
      try {
        return (await client.execute(action)) as Reply<T>;
      } catch (error) {
        if (
          !(error instanceof CrewError) ||
          error.code !== 'VERSION_CONFLICT' ||
          retry >= 7
        )
          throw error;
        action.expected_version = (await status()).run_version;
      }
    }
  };
  const prepare = async (method: ToolCall['method'], args: unknown) =>
    envelope(method, args, (await status()).run_version);
  return { client, runId, status, call, prepare };
}

async function fixture(
  t: TestContext,
  provider: ScriptedProvider,
  maximum = 1,
  mode: Run['delivery_mode'] = 'documentation',
) {
  const directory = mkdtempSync(join(tmpdir(), 'crew runtime simulated '));
  const root = join(directory, 'project with spaces');
  mkdirSync(root);
  if (mode === 'code') {
    git(root, 'init', '--initial-branch=main');
    writeFileSync(join(root, 'baseline.txt'), 'User baseline preserved\n');
    git(root, 'add', '--all');
    git(
      root,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@localhost',
      'commit',
      '-m',
      'test baseline',
    );
  }
  const project = identifyProject(root, join(directory, 'private data'));
  project.config.max_active_agents = maximum;
  if (mode === 'code')
    project.config.verification_commands = [
      {
        id: 'check:combined-files',
        argv: [
          process.execPath,
          '-e',
          "const a=require('node:assert/strict'),f=require('node:fs');a.equal(f.readFileSync('features/a.txt','utf8'),'feature a');a.equal(f.readFileSync('features/b.txt','utf8'),'feature b');console.log('Both actual files pass on the combined candidate')",
        ],
        cwd: '.',
        timeout_seconds: 10,
      },
    ];
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
        delivery_mode: mode,
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
    const provider = new ScriptedProvider(
      async ({ request }) => {
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
                verification_ids: delivery.verifications.map(
                  (proof) => proof.id,
                ),
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
            artifacts: [],
            verifications: [],
            criteria_claimed: own.spec.acceptance_criteria.map(
              (item) => item.id,
            ),
            limitations: [],
            next_information: [],
            created_at: now(),
          };
          assert.equal(
            JSON.stringify(declared).includes('sha256:'),
            false,
            'The model supplies paths without inventing any revision or hash',
          );
          const captured = (
            await api.call<Handoff>('submit_handoff', {
              handoff: declared,
              document_paths: ['docs/livrable.md'],
            })
          ).result;
          assert.match(captured.source_revision!, /^sha256:[a-f0-9]{64}$/);
          const file = captured.artifacts.find((item) => item.kind === 'file')!;
          assert.equal(file.revision, `sha256:${digest(content)}`);
          assert.match(file.id, /^artifact:/);
          assert.equal(file.producer_attempt_id, own.active_attempt_id);
          assert.match(file.reference, /^artifacts\//);
          assert.equal(
            (await api.status()).result.tasks[0]!.status,
            'in_review',
          );
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
            summary:
              'Read exact immutable document and service-observed checks',
            findings: [],
            verification_ids: delivery.verifications.map((proof) => proof.id),
            created_at: now(),
          };
          await api.call('submit_review', { review });
        } else assert.fail(`Unexpected scripted role ${request.role}`);
      },
      { repeatSession: true, observeRealProcess: true },
    );
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
    const sessionsPublished = providerEvents.filter(
      (event) => event.type === 'provider.session',
    );
    assert.equal(
      sessionsPublished.length,
      provider.turns.length * 2,
      'Repeated native session events must remain in the journal',
    );
    for (const turn of provider.turns) {
      const expected =
        provider.turns.filter((item) => item.nativeId === turn.nativeId)
          .length * 2;
      assert.equal(
        sessionsPublished.filter(
          (event) =>
            (event.payload as Record<string, unknown>).native_session_id ===
            turn.nativeId,
        ).length,
        expected,
      );
    }
    assert.equal(
      providerEvents.filter((event) => event.type === 'provider.text').length,
      provider.turns.length * 2,
    );
    assert.ok(
      !events.some((event) =>
        JSON.stringify(event.payload).includes('IDEMPOTENCY_CONFLICT'),
      ),
    );
    assert.ok(
      providerEvents.every(
        (event) =>
          (event.payload as Record<string, unknown>).provenance === 'simulated',
      ),
    );
    assert.equal(f.store.records(run.id, 'final').length, 1);
  },
);

test(
  'a queued task waiting for a user answer leaves an independent mission runnable and retains the actual user response',
  { timeout: 15_000 },
  async (t) => {
    let configured = false;
    let adopted = false;
    const launched: string[] = [];
    const provider = new ScriptedProvider(async ({ request }) => {
      const api = agent(request),
        status = (await api.status()).result;
      if (request.role === 'chief') {
        if (!configured) {
          configured = true;
          for (const suffix of ['needs-user', 'independent'])
            await api.call('create_task', {
              task: {
                ...task(status.run, `task:${suffix}`, 'documenter'),
                objective: `Write docs/${suffix}.md when allowed`,
                expected_deliverables: [`docs/${suffix}.md`],
              },
            });
          await api.call('request_user_input', {
            question_id: 'question:format',
            question: 'Which format should task:needs-user use?',
            options: [
              {
                label: 'Markdown',
                consequence: 'Keep the document editable as text',
              },
            ],
            affects_task_ids: ['task:needs-user'],
            blocking: true,
          });
          // Persist both requests: the scheduler must gate the affected task without blocking its sibling.
          for (const suffix of ['needs-user', 'independent'])
            await api.call('delegate_task', {
              task_id: `task:${suffix}`,
              provider: 'fake',
              model: null,
            });
        } else if (status.user_responses.length && !adopted) {
          const response = status.user_responses[0]!;
          assert.equal(response.answer, 'Markdown');
          await api.call('record_decision', {
            decision_id: 'decision:actual-user-answer',
            question: 'Approved output format',
            answer: response.answer,
            requested_status: 'approved',
            basis: 'user_response',
            user_response_id: response.id,
            source_ids: [response.source_id],
            affects_task_ids: ['task:needs-user'],
            supersedes: null,
          });
          adopted = true;
        }
        return;
      }
      const own = status.tasks[0]!;
      launched.push(own.id);
      if (own.id === 'task:needs-user')
        assert.ok(status.run.status === 'running');
      const suffix = own.id.slice('task:'.length),
        relative = `docs/${suffix}.md`;
      mkdirSync(join(request.cwd, 'docs'), { recursive: true });
      writeFileSync(join(request.cwd, relative), `# ${suffix}\n`);
      const handoff: Handoff = {
        schema_version: 1,
        id: `handoff:${suffix}`,
        task_id: own.id,
        run_id: api.runId,
        attempt_id: own.active_attempt_id!,
        generation: own.generation,
        status: 'delivered',
        summary: 'Actual document produced after scheduler authorization',
        source_revision: null,
        artifacts: [
          {
            id: `artifact:${suffix}`,
            kind: 'file',
            reference: relative,
            revision: `sha256:${'0'.repeat(64)}`,
            producer_attempt_id: own.active_attempt_id!,
            created_at: now(),
          },
        ],
        verifications: [],
        criteria_claimed: own.spec.acceptance_criteria.map(
          (criterion) => criterion.id,
        ),
        limitations: [],
        next_information: [],
        created_at: now(),
      };
      await api.call('submit_handoff', { handoff });
    });
    const f = await fixture(t, provider, 3);
    const run = await f.create();
    const wait = async (condition: () => boolean) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (provider.failures.length) throw provider.failures[0];
        const status = (await f.owner.admin({
          method: 'status',
          arguments: { run_id: run.id, limit: 1000 },
        })) as { events: CrewEvent[] };
        assert.deepEqual(
          status.events
            .filter((event) => event.type === 'turn.launch_failed')
            .map((event) => event.payload),
          [],
          'An open user question is a durable scheduling gate, not a failed worker launch',
        );
        if (condition()) return;
        await delay(10);
      }
      assert.fail('Question scenario did not advance its independent work');
    };
    await wait(() => existsSync(join(f.root, 'docs/independent.md')));
    assert.equal(existsSync(join(f.root, 'docs/needs-user.md')), false);
    assert.deepEqual(launched, ['task:independent']);
    const response = (await f.owner.admin({
      method: 'answer',
      arguments: {
        run_id: run.id,
        question_id: 'question:format',
        answer: 'Markdown',
      },
    })) as UserResponse;
    await wait(() => adopted && existsSync(join(f.root, 'docs/needs-user.md')));
    await f.runtime.scheduler.idle();
    assert.equal(response.user_actor_id, 'user:local');
    const decision = f.store.records<Decision>(run.id, 'decision')[0]!;
    assert.equal(decision.answer, response.answer);
    assert.equal(decision.approved_by, response.user_actor_id);
    assert.ok(decision.source_ids.includes(response.source_id));
    assert.equal(
      f.store.records<CoordinationQuestion>(run.id, 'question')[0]!.response_id,
      response.id,
    );
    assert.deepEqual(launched, ['task:independent', 'task:needs-user']);
    assert.equal(f.store.getRun(run.id).status, 'running');
  },
);

test(
  'lost HTTP response can be replayed with the same action key and a native success cannot finish an unproved task',
  { timeout: 15_000 },
  async (t) => {
    let observed!: () => void;
    const observedReply = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const provider = new ScriptedProvider(async ({ request }) => {
      const api = agent(request),
        current = (await api.status()).result;
      assert.equal(request.role, 'chief');
      const spec = task(current.run, 'task:replay', 'documenter');
      const action = await api.prepare('create_task', { task: spec });
      await discardReply(request, action);
      const reconnect = new SupervisorClient({
        endpointFile: request.bridge!.env.AVITY_CREW_ENDPOINT_FILE!,
        capability: request.bridge!.env.AVITY_CREW_CAPABILITY!,
      });
      const first = (await reconnect.execute(action)) as Reply<TaskState>;
      const replay = (await reconnect.execute(action)) as Reply<TaskState>;
      assert.deepEqual(replay, first);
      const status = (await api.status()).result;
      assert.equal(status.tasks.length, 1);
      assert.equal(status.tasks[0]!.id, spec.id);
      assert.equal(status.tasks[0]!.status, 'ready');
      assert.equal(status.run.status, 'running');
      observed();
    });
    const f = await fixture(t, provider);
    const run = await f.create();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            provider.failures[0] ??
              new Error('Lost-response replay did not finish'),
          ),
        5_000,
      );
      observedReply.then(
        () => {
          clearTimeout(timeout);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
    await f.runtime.scheduler.idle();
    assert.deepEqual(provider.failures, []);
    assert.equal(f.store.tasks(run.id).length, 1);
    assert.equal(f.store.records(run.id, 'final').length, 0);
    assert.equal(f.store.getRun(run.id).status, 'running');
    assert.equal(provider.turns.length, 1);
  },
);

test(
  'two simulated writers overlap in real isolated Git workspaces and only their reviewed checked combination is promoted',
  { timeout: 25_000 },
  async (t) => {
    const writers = barrier(2);
    const workspaces: string[] = [];
    const resources: { port: string; database: string }[] = [];
    let candidateRevision: string | undefined;
    let baseRevision: string | undefined;
    let acceptedAfterReview = false;
    const targetRef = 'refs/heads/crew-runtime-delivery';
    const provider = new ScriptedProvider(async ({ request }) => {
      const api = agent(request),
        current = (await api.status()).result;
      if (request.role === 'chief') {
        if (!current.tasks.length) {
          const project = (
            await api.call<{ git: { revision: string } }>('inspect_project', {
              focus: ['**'],
              requested_source_ids: [],
            })
          ).result;
          baseRevision = project.git.revision;
          assert.match(baseRevision, /^git:/);
          for (const suffix of ['a', 'b']) {
            const spec: TaskSpec = {
              ...task(current.run, `task:code-${suffix}`, 'documenter'),
              role: 'developer',
              objective: `Write features/${suffix}.txt with feature ${suffix}`,
              scope: {
                read_paths: ['**'],
                write_paths: [`features/${suffix}.txt`],
                excluded_paths: [],
              },
              base_revision: baseRevision,
              expected_deliverables: [`features/${suffix}.txt`],
            };
            await api.call('create_task', { task: spec });
          }
          for (const suffix of ['a', 'b'])
            await api.call('delegate_task', {
              task_id: `task:code-${suffix}`,
              provider: 'fake',
              model: null,
            });
          await writers.ready;
          return;
        }
        const targets = current.tasks.filter(
          (item) => item.spec.role === 'developer',
        );
        if (
          targets.some(
            (item) => !['in_review', 'accepted'].includes(item.status),
          )
        )
          return;
        const deliveries = await Promise.all(
          targets.map(
            async (item) =>
              (
                await api.call<Collected>('collect_delivery', {
                  task_id: item.id,
                  handoff_id: null,
                })
              ).result,
          ),
        );
        if (!current.tasks.some((item) => item.spec.role === 'reviewer')) {
          const candidate = (
            await api.call<{
              status: string;
              candidateRevision: string;
              proofs: { exitCode: number; candidateRevision: string }[];
            }>('propose_integration', {
              handoff_ids: deliveries.map((item) => item.handoff.id),
              target_ref: targetRef,
              expected_target_revision: baseRevision,
              required_check_ids: ['check:combined-files'],
            })
          ).result;
          assert.equal(candidate.status, 'validated');
          candidateRevision = candidate.candidateRevision;
          assert.ok(
            candidate.proofs.every(
              (proof) =>
                proof.exitCode === 0 &&
                proof.candidateRevision === candidateRevision,
            ),
          );
          for (const suffix of ['a', 'b']) {
            const spec: TaskSpec = {
              ...task(current.run, `task:review-${suffix}`, 'reviewer'),
              objective: `Review task:code-${suffix} source and exact combined candidate`,
              scope: {
                read_paths: ['**'],
                write_paths: [],
                excluded_paths: [],
              },
              base_revision: candidateRevision,
            };
            await api.call('create_task', { task: spec });
            await api.call('delegate_task', {
              task_id: spec.id,
              provider: 'fake',
              model: null,
            });
          }
          return;
        }
        if (
          deliveries.some(
            (delivery) =>
              !delivery.reviews.some(
                (review) =>
                  review.outcome === 'approved' &&
                  review.verification_scope === 'combined_code' &&
                  review.tested_revision === candidateRevision,
              ),
          )
        )
          return;
        for (const delivery of deliveries) {
          const review = delivery.reviews.find(
            (item) => item.outcome === 'approved',
          )!;
          const result = (
            await api.call<TaskState>('accept_delivery', {
              handoff_id: delivery.handoff.id,
              review_ids: [review.id],
              verification_ids: delivery.verifications.map((proof) => proof.id),
              accepted_revision: candidateRevision,
            })
          ).result;
          assert.equal(result.status, 'accepted');
          assert.equal(result.accepted_revision, candidateRevision);
        }
        acceptedAfterReview = true;
        const proof = deliveries[0]!.verifications[0]!;
        try {
          const final = (
            await api.call<Run>('finish_run', {
              summary:
                'Two real isolated changes reviewed and tested together; providers simulated',
              criterion_evidence: proof.criterion_ids.map((id) => ({
                criterion_id: id,
                evidence_artifact_ids: proof.evidence_artifact_ids,
              })),
              delivered_artifact_ids: deliveries.flatMap((delivery) =>
                delivery.handoff.artifacts.map((artifact) => artifact.id),
              ),
            })
          ).result;
          assert.equal(final.status, 'completed');
        } catch (error) {
          if (!(error instanceof CrewError) || error.code !== 'RUN_BUSY')
            throw error;
          // A review tool may return before its provider turn has actually stopped.
          // That terminal observation wakes the next chief turn; acceptance is never inferred.
        }
        return;
      }
      const own = current.tasks[0]!;
      if (request.role === 'developer') {
        workspaces.push(request.cwd);
        resources.push({
          port: request.bridge!.env.PORT!,
          database: request.bridge!.env.AVITY_CREW_DATABASE_PATH!,
        });
        await writers.enter();
        const suffix = own.id.endsWith('-a') ? 'a' : 'b';
        mkdirSync(join(request.cwd, 'features'), { recursive: true });
        writeFileSync(
          join(request.cwd, `features/${suffix}.txt`),
          `feature ${suffix}`,
        );
        const handoff: Handoff = {
          schema_version: 1,
          id: `handoff:code-${suffix}`,
          task_id: own.id,
          run_id: api.runId,
          attempt_id: own.active_attempt_id!,
          generation: own.generation,
          status: 'delivered',
          summary: `Actual isolated feature ${suffix}`,
          source_revision: null,
          artifacts: [],
          verifications: [],
          criteria_claimed: own.spec.acceptance_criteria.map((item) => item.id),
          limitations: [],
          next_information: [],
          created_at: now(),
        };
        const captured = (
          await api.call<Handoff>('submit_handoff', { handoff })
        ).result;
        assert.match(captured.source_revision!, /^git:/);
        assert.ok(
          captured.artifacts.some((artifact) => artifact.kind === 'git_commit'),
        );
      } else if (request.role === 'reviewer') {
        assert.equal(request.permissions.sandbox, 'read-only');
        assert.equal(
          `git:${git(request.cwd, 'rev-parse', 'HEAD')}`,
          candidateRevision,
        );
        assert.equal(
          readFileSync(join(request.cwd, 'features/a.txt'), 'utf8'),
          'feature a',
        );
        assert.equal(
          readFileSync(join(request.cwd, 'features/b.txt'), 'utf8'),
          'feature b',
        );
        const suffix = own.id.endsWith('-a') ? 'a' : 'b';
        const delivery = (
          await api.call<Collected>('collect_delivery', {
            task_id: `task:code-${suffix}`,
            handoff_id: null,
          })
        ).result;
        assert.ok(
          delivery.verifications.every(
            (proof) =>
              proof.tested_revision === candidateRevision &&
              proof.result === 'passed' &&
              proof.exit_code === 0,
          ),
        );
        const review: Review = {
          schema_version: 1,
          id: `review:code-${suffix}`,
          run_id: api.runId,
          review_task_id: own.id,
          review_of_task_id: delivery.handoff.task_id,
          handoff_id: delivery.handoff.id,
          outcome: 'approved',
          verification_scope: 'combined_code',
          source_revision: delivery.handoff.source_revision!,
          tested_revision: candidateRevision!,
          summary:
            'Read actual source and both files in exact combined candidate',
          findings: [],
          verification_ids: delivery.verifications.map((proof) => proof.id),
          created_at: now(),
        };
        await api.call('submit_review', { review });
      } else assert.fail(`Unexpected role ${request.role}`);
    });
    const f = await fixture(t, provider, 3, 'code');
    const initial = git(f.root, 'rev-parse', 'HEAD');
    writeFileSync(
      join(f.root, 'user-note.txt'),
      'User work must stay in the principal folder',
    );
    const run = await f.create();
    await f.completed(run.id);
    assert.deepEqual(provider.failures, []);
    assert.equal(workspaces.length, 2);
    assert.equal(new Set(workspaces).size, 2);
    assert.equal(new Set(resources.map((item) => item.port)).size, 2);
    assert.equal(new Set(resources.map((item) => item.database)).size, 2);
    assert.equal(provider.peak, 3);
    assert.ok(acceptedAfterReview);
    assert.equal(
      git(f.root, 'rev-parse', targetRef),
      candidateRevision!.slice(4),
    );
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), initial);
    assert.equal(
      readFileSync(join(f.root, 'user-note.txt'), 'utf8'),
      'User work must stay in the principal folder',
    );
    assert.equal(
      git(f.root, 'show', `${targetRef}:features/a.txt`),
      'feature a',
    );
    assert.equal(
      git(f.root, 'show', `${targetRef}:features/b.txt`),
      'feature b',
    );
    assert.ok(
      f.store.tasks(run.id).every((item) => item.status === 'accepted'),
    );
    assert.equal(f.store.tasks(run.id).length, 4);
  },
);

test(
  'changes_requested produces a recorded correction strategy, a new attempt and new observed evidence before acceptance',
  { timeout: 20_000 },
  async (t) => {
    let chiefTurns = 0,
      writes = 0,
      inspections = 0;
    const sequence: string[] = [];
    const capturedRevisions: string[] = [];
    const capturedAttempts: string[] = [];
    const contents = [
      '# Draft\n\nMissing the required conclusion.\n',
      '# Corrected result\n\nThe required conclusion is now present.\n',
    ];
    const provider = new ScriptedProvider(async ({ request }) => {
      const api = agent(request),
        current = (await api.status()).result;
      if (request.role === 'chief') {
        sequence.push(`chief:${++chiefTurns}`);
        if (chiefTurns === 1) {
          const spec = task(current.run, 'task:correctable', 'documenter');
          await api.call('create_task', { task: spec });
          await api.call('delegate_task', {
            task_id: spec.id,
            provider: 'fake',
            model: null,
          });
        } else if (chiefTurns === 2 || chiefTurns === 4) {
          const spec = {
            ...task(current.run, `task:inspection-${chiefTurns}`, 'reviewer'),
            objective:
              'Review task:correctable; require the stated conclusion in the exact captured document',
          };
          await api.call('create_task', { task: spec });
          await api.call('delegate_task', {
            task_id: spec.id,
            provider: 'fake',
            model: null,
          });
        } else if (chiefTurns === 3) {
          const delivery = (
            await api.call<Collected>('collect_delivery', {
              task_id: 'task:correctable',
              handoff_id: null,
            })
          ).result;
          assert.equal(delivery.reviews[0]!.outcome, 'changes_requested');
          assert.equal(
            current.tasks.find((item) => item.id === 'task:correctable')!
              .status,
            'changes_requested',
          );
          await assert.rejects(
            api.call('accept_delivery', {
              handoff_id: delivery.handoff.id,
              review_ids: delivery.reviews.map((review) => review.id),
              verification_ids: delivery.verifications.map((proof) => proof.id),
              accepted_revision: delivery.handoff.source_revision,
            }),
            hasCode('INVALID_TRANSITION'),
          );
          await api.call('record_decision', {
            decision_id: 'decision:targeted-correction',
            question: 'How to address the independent review?',
            answer:
              'Keep the required conclusion criterion and correct the document in a new attempt',
            requested_status: 'approved',
            basis: 'technical_judgment',
            user_response_id: null,
            source_ids: [],
            affects_task_ids: ['task:correctable'],
            supersedes: null,
          });
          assert.equal(
            (
              await api.call<Delegation>('delegate_task', {
                task_id: 'task:correctable',
                provider: 'fake',
                model: null,
              })
            ).result.status,
            'queued',
          );
        } else if (chiefTurns === 5) {
          const delivery = (
            await api.call<Collected>('collect_delivery', {
              task_id: 'task:correctable',
              handoff_id: null,
            })
          ).result;
          assert.equal(delivery.reviews.length, 1);
          assert.equal(delivery.reviews[0]!.outcome, 'approved');
          assert.ok(
            delivery.verifications.every(
              (proof) =>
                proof.tested_revision === delivery.handoff.source_revision,
            ),
          );
          await api.call('accept_delivery', {
            handoff_id: delivery.handoff.id,
            review_ids: [delivery.reviews[0]!.id],
            verification_ids: delivery.verifications.map((proof) => proof.id),
            accepted_revision: delivery.handoff.source_revision,
          });
          const proof = delivery.verifications[0]!;
          await api.call('finish_run', {
            summary:
              'Independent refusal addressed by a new delivery and fresh checks',
            criterion_evidence: proof.criterion_ids.map((id) => ({
              criterion_id: id,
              evidence_artifact_ids: proof.evidence_artifact_ids,
            })),
            delivered_artifact_ids: delivery.handoff.artifacts.map(
              (artifact) => artifact.id,
            ),
          });
        } else assert.fail('Unexpected continuation in correction scenario');
        return;
      }
      const own = current.tasks[0]!;
      if (request.role === 'documenter') {
        sequence.push(`write:${++writes}`);
        const content = contents[writes - 1]!;
        assert.ok(content);
        mkdirSync(join(request.cwd, 'docs'), { recursive: true });
        writeFileSync(join(request.cwd, 'docs/livrable.md'), content);
        const declaration: Handoff = {
          schema_version: 1,
          id: `handoff:correction-${writes}`,
          task_id: own.id,
          run_id: api.runId,
          attempt_id: own.active_attempt_id!,
          generation: own.generation,
          status: 'delivered',
          summary:
            writes === 1
              ? 'Initial draft for independent inspection'
              : 'Targeted correction retains the original criterion',
          source_revision: null,
          artifacts: [
            {
              id: `artifact:declared-${writes}`,
              kind: 'file',
              reference: 'docs/livrable.md',
              revision: `sha256:${'0'.repeat(64)}`,
              producer_attempt_id: own.active_attempt_id!,
              created_at: now(),
            },
          ],
          verifications: [],
          criteria_claimed: own.spec.acceptance_criteria.map(
            (criterion) => criterion.id,
          ),
          limitations: [],
          next_information: [],
          created_at: now(),
        };
        const captured = (
          await api.call<Handoff>('submit_handoff', { handoff: declaration })
        ).result;
        capturedRevisions.push(captured.source_revision!);
        capturedAttempts.push(captured.attempt_id);
      } else if (request.role === 'reviewer') {
        sequence.push(`inspect:${++inspections}`);
        const delivery = (
          await api.call<Collected>('collect_delivery', {
            task_id: 'task:correctable',
            handoff_id: null,
          })
        ).result;
        const content = delivery.evidence.find(
          (artifact) => artifact.kind === 'file',
        )!.content_excerpt;
        assert.equal(content, contents[inspections - 1]);
        const negative = inspections === 1;
        const review: Review = {
          schema_version: 1,
          id: `review:correction-${inspections}`,
          run_id: api.runId,
          review_task_id: own.id,
          review_of_task_id: delivery.handoff.task_id,
          handoff_id: delivery.handoff.id,
          outcome: negative ? 'changes_requested' : 'approved',
          verification_scope: negative ? 'source' : 'documentation',
          source_revision: delivery.handoff.source_revision!,
          tested_revision: negative ? null : delivery.handoff.source_revision,
          summary: negative
            ? 'Required conclusion is missing; request a targeted correction'
            : 'Required conclusion present in the new exact snapshot',
          findings: negative
            ? [
                {
                  severity: 'blocking',
                  description: 'Required conclusion is absent',
                  reference: 'docs/livrable.md',
                },
              ]
            : [],
          verification_ids: negative
            ? []
            : delivery.verifications.map((proof) => proof.id),
          created_at: now(),
        };
        await api.call('submit_review', { review });
      } else assert.fail(`Unexpected role ${request.role}`);
    });
    const f = await fixture(t, provider);
    const run = await f.create();
    await f.completed(run.id);
    assert.deepEqual(provider.failures, []);
    assert.deepEqual(sequence, [
      'chief:1',
      'write:1',
      'chief:2',
      'inspect:1',
      'chief:3',
      'write:2',
      'chief:4',
      'inspect:2',
      'chief:5',
    ]);
    assert.equal(new Set(capturedAttempts).size, 2);
    assert.equal(new Set(capturedRevisions).size, 2);
    assert.equal(provider.peak, 1);
    assert.equal(f.store.records(run.id, 'decision').length, 1);
    const handoffs = f.store.records<Handoff>(run.id, 'handoff');
    const oldFile = handoffs[0]!.artifacts.find(
      (artifact) => artifact.kind === 'file',
    )!;
    assert.equal(f.store.readArtifact(oldFile).toString('utf8'), contents[0]);
    assert.equal(
      f.store.getTask('task:correctable').accepted_revision,
      handoffs[1]!.source_revision,
    );
    assert.equal(f.store.records(run.id, 'acceptance').length, 1);
    assert.ok(
      f.store.tasks(run.id).every((item) => item.status === 'accepted'),
    );
    assert.equal(
      readFileSync(join(f.root, 'docs/livrable.md'), 'utf8'),
      contents[1],
    );
  },
);

test(
  'acknowledged pause fences a chief still awaiting provider probe before any native turn can start',
  { timeout: 10_000 },
  async (t) => {
    let entered!: () => void, release!: () => void;
    const probing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class ProbeGateProvider extends ScriptedProvider {
      override async probe(): Promise<ProviderCapabilities> {
        entered();
        await gate;
        return super.probe();
      }
    }
    const provider = new ProbeGateProvider(async () => {
      assert.fail(
        'A provider turn cannot start after pause has been acknowledged',
      );
    });
    const f = await fixture(t, provider);
    const run = await f.create();
    await probing;
    assert.equal(provider.turns.length, 0);
    const paused = (await f.owner.admin({
      method: 'pause',
      arguments: { run_id: run.id },
    })) as Run;
    assert.equal(paused.status, 'paused');
    assert.equal(provider.turns.length, 0);
    release();
    await f.runtime.scheduler.idle();
    assert.equal(
      provider.turns.length,
      0,
      'Releasing an awaited probe cannot cross the acknowledged pause fence',
    );
    assert.equal(f.store.getRun(run.id).status, 'paused');
    assert.deepEqual(provider.failures, []);
  },
);

test(
  'administrative status bounds accumulated context bodies while explicit inspection preserves exact context',
  { timeout: 10_000 },
  async (t) => {
    let ready!: () => void;
    const initialTurn = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const provider = new ScriptedProvider(async () => {
      ready();
    });
    const f = await fixture(t, provider);
    const run = await f.create();
    await initialTurn;
    await f.runtime.scheduler.idle();
    const initialCount = f.store.records(run.id, 'context').length;
    const user: Actor = {
      id: 'user:local',
      role: 'user',
      project_id: f.project.id,
      run_id: run.id,
      generation: run.generation,
      task_id: null,
      attempt_id: null,
    };
    const body =
      'large context payload retained for explicit inspection\n'.repeat(1300);
    assert.ok(Buffer.byteLength(body) >= 67_000);
    let latest!: ContextBundle;
    // Test fixture setup through the real Store API, never SQL or simulated-agent authority.
    for (let version = 1; version <= 20; version++) {
      latest = {
        schema_version: 1,
        id: `context:large-${version}`,
        run_id: run.id,
        subject_kind: 'control',
        subject_id: 'control:large-fixture',
        version,
        objective: 'Preserve a large historical context',
        sources: [],
        decision_ids: [],
        layers: {
          team_rules: 'Fixture rules',
          role_rules: 'Fixture role',
          mission: `${version}:${body}`,
          updates: [],
        },
        budget: {
          max_input_tokens: 120_000,
          estimated_input_tokens: 22_000,
          measurement: 'estimated',
        },
        content_sha256: digest(`${version}:${body}`),
        created_at: now(),
      };
      f.store.saveContext(
        user,
        latest,
        `fixture:save-context-${version}`,
        f.store.getRun(run.id).version,
      );
    }
    const status = (await f.owner.admin({
      method: 'status',
      arguments: { run_id: run.id, limit: 1 },
    })) as { context_count: number; contexts: Record<string, unknown>[] };
    assert.equal(status.context_count, initialCount + 20);
    assert.equal(status.contexts.length, 20);
    assert.ok(
      Buffer.byteLength(JSON.stringify(status)) < 100_000,
      'Routine status remains bounded independently of historical prompt size',
    );
    assert.ok(
      status.contexts.every(
        (context) => !('layers' in context) && !('prompt' in context),
      ),
    );
    const metadata = status.contexts.at(-1)!;
    assert.equal(metadata.id, latest.id);
    assert.equal(metadata.content_sha256, latest.content_sha256);
    assert.equal(metadata.subject_id, latest.subject_id);
    const inspected = (await f.owner.admin({
      method: 'inspect_context',
      arguments: { run_id: run.id, subject_id: latest.subject_id },
    })) as { context: ContextBundle };
    assert.deepEqual(inspected.context, latest);
    assert.equal(inspected.context.layers.mission, `20:${body}`);
    assert.equal(f.store.records(run.id, 'context').length, initialCount + 20);
  },
);

test(
  'pause and resume revoke the old chief capability, and replacement preserves the objective, decision and source without a chief task',
  { timeout: 20_000 },
  async (t) => {
    let turnCount = 0;
    const notify: (() => void)[] = [];
    const prepared = [0, 1, 2].map(
      () =>
        new Promise<void>((resolve) => {
          notify.push(resolve);
        }),
    );
    const provider = new ScriptedProvider(async ({ request, signal }) => {
      const index = turnCount++;
      const api = agent(request),
        status = (await api.status()).result;
      assert.equal(request.role, 'chief');
      assert.deepEqual(status.tasks, []);
      const context = (
        await api.call<{ context: ContextBundle }>('read_context', {
          subject_id: `control:${api.runId}`,
          source_ids: [],
          after_version: 0,
        })
      ).result.context;
      const source = context.sources.find(
        (item) => item.reference === 'requirements.md',
      );
      assert.ok(
        source,
        'The original requirement remains available in each continuation',
      );
      if (index === 0)
        await api.call('record_decision', {
          decision_id: 'decision:preserve-objective',
          question: 'What should remain stable during interruption?',
          answer: 'Preserve the original objective and acceptance criteria',
          requested_status: 'approved',
          basis: 'technical_judgment',
          user_response_id: null,
          source_ids: [source.id],
          affects_task_ids: [],
          supersedes: null,
        });
      else
        assert.ok(context.decision_ids.includes('decision:preserve-objective'));
      notify[index]!();
      if (index < 2) await untilInterrupted(signal!);
      else assert.equal(request.model, 'replacement:test');
    });
    const f = await fixture(t, provider);
    writeFileSync(
      join(f.root, 'requirements.md'),
      '# Original requirement\nKeep the objective and evidence criteria through interruptions.\n',
    );
    const run = await f.create();
    await bounded(
      prepared[0]!,
      'Initial chief did not reach its interruption boundary',
    );
    const first = agent(provider.turns[0]!.request);
    const paused = (await f.owner.admin({
      method: 'pause',
      arguments: { run_id: run.id },
    })) as Run;
    assert.equal(paused.status, 'paused');
    await assert.rejects(first.client.tools(run.id), deniedCapability);
    const resumed = (await f.owner.admin({
      method: 'resume',
      arguments: { run_id: run.id },
    })) as Run;
    assert.equal(resumed.status, 'running');
    assert.equal(resumed.objective, run.objective);
    await bounded(prepared[1]!, 'Resumed chief did not launch');
    assert.ok(provider.turns[1]!.resumed);
    assert.equal(provider.turns[1]!.nativeId, provider.turns[0]!.nativeId);
    await assert.rejects(first.client.tools(run.id), deniedCapability);
    const second = agent(provider.turns[1]!.request);
    const replaced = (await f.owner.admin({
      method: 'replace_chief',
      arguments: {
        run_id: run.id,
        provider: 'fake',
        model: 'replacement:test',
      },
    })) as Run;
    assert.ok(replaced.generation > resumed.generation);
    await assert.rejects(second.client.tools(run.id), deniedCapability);
    await bounded(prepared[2]!, 'Replacement chief did not launch');
    await f.runtime.scheduler.idle();
    const final = f.store.getRun(run.id);
    assert.equal(final.objective, run.objective);
    assert.deepEqual(final.acceptance_criteria, run.acceptance_criteria);
    assert.equal(final.chief_model, 'replacement:test');
    assert.deepEqual(f.store.tasks(run.id), []);
    assert.deepEqual(f.store.attempts(run.id), []);
    assert.equal(f.store.records<Decision>(run.id, 'decision').length, 1);
    assert.equal(provider.turns.length, 3);
    assert.equal(provider.peak, 1);
    assert.deepEqual(provider.failures, []);
  },
);

async function ownedProcess(t: TestContext) {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.stdin?.on('error', () => {});
  const exited = new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve());
    child.once('error', reject);
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGTERM');
    child.stdin?.end();
    await exited;
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve());
    child.once('error', reject);
  });
  const identity = await observeProcess(child.pid!);
  assert.ok(identity);
  assert.equal(identity.group_id, child.pid);
  return { child, identity, exited };
}

function crashState(
  f: Awaited<ReturnType<typeof fixture>>,
  identity: ProcessIdentity | null,
  intentOnly = false,
) {
  const run: Run = {
    id: 'run:crash-fixture',
    project_id: f.project.id,
    objective:
      'Resume this exact original objective after explicit process reconciliation',
    constraints: ['Preserve uncertain outcomes until inspected'],
    acceptance_criteria: [
      {
        id: 'criterion:crash',
        description: 'No duplicate turn or invented business success',
        required: true,
        verification: 'runtime test',
      },
    ],
    delivery_mode: 'documentation',
    status: 'planning',
    chief_provider: 'fake',
    chief_model: null,
    generation: 1,
    version: 0,
    max_active_agents: 1,
    created_at: now(),
    updated_at: now(),
  };
  f.store.createRun(run, 'fixture:create-crash-run');
  const user = serviceActor(f.store, run.id),
    version = () => f.store.getRun(run.id).version;
  f.store.updateRunStatus(user, 'running', 'fixture:crash-running', version());
  const chief: Actor = {
    ...user,
    id: requestId(run.id + ':1', 'chief'),
    role: 'chief',
  };
  const session: AgentSession = {
    id: chief.id,
    run_id: run.id,
    task_id: null,
    provider: 'fake',
    model: null,
    native_session_id: 'simulated:exact-recovered-conversation',
    cli_version: 'fixture:1',
    cwd: f.root,
    capabilities: null,
  };
  f.store.registerChiefSession(
    user,
    session,
    'fixture:prior-session',
    version(),
  );
  const operation = f.store.beginOperation(
    user,
    'provider.turn',
    JSON.stringify({
      actor: chief,
      session_id: session.id,
      invocation: 'turn:interrupted-service',
    }),
    'fixture:uncertain-turn',
    version(),
  );
  if (!intentOnly)
    f.store.observeOperation(
      user,
      operation.id,
      'running',
      {
        actor: chief,
        session_id: session.id,
        native_session_id: session.native_session_id,
        pid: identity?.pid ?? null,
        identity,
      },
      'fixture:prior-process',
      version(),
    );
  return { run, chief, session, operation };
}

test(
  'startup preserves an owned uncertain process until explicit resume stops it and resumes the exact chief conversation without business success',
  { timeout: 15_000 },
  async (t) => {
    let ready!: () => void;
    const resumedTurn = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const provider = new ScriptedProvider(
      async ({ request, nativeId, resumed }) => {
        assert.ok(resumed);
        assert.equal(nativeId, 'simulated:exact-recovered-conversation');
        assert.equal(request.role, 'chief');
        const status = (await agent(request).status()).result;
        assert.equal(
          status.run.objective,
          'Resume this exact original objective after explicit process reconciliation',
        );
        assert.deepEqual(status.tasks, []);
        ready();
      },
    );
    const f = await fixture(t, provider),
      owned = await ownedProcess(t);
    const state = crashState(f, owned.identity);
    f.runtime.initialize();
    assert.equal(f.store.getRun(state.run.id).status, 'waiting_provider');
    assert.equal(provider.turns.length, 0);
    assert.doesNotThrow(() => process.kill(owned.child.pid!, 0));
    assert.equal(
      f.store.getRecord<Operation>(
        state.run.id,
        'operation',
        state.operation.id,
      ).status,
      'running',
    );
    await f.owner.admin({
      method: 'resume',
      arguments: { run_id: state.run.id },
    });
    await bounded(
      resumedTurn,
      'Explicit recovery did not resume the exact chief conversation',
    );
    await f.runtime.scheduler.idle();
    await owned.exited;
    await assert.rejects(
      agent(provider.turns[0]!.request).client.tools(state.run.id),
      deniedCapability,
    );
    const recovered = f.store.getRecord<Operation>(
      state.run.id,
      'operation',
      state.operation.id,
    );
    assert.equal(recovered.status, 'completed');
    assert.equal(
      (recovered.result as { recovery: string }).recovery,
      'stopped',
    );
    assert.equal(
      (recovered.result as { business_success: boolean }).business_success,
      false,
    );
    const event = f.store
      .events(state.run.id, 0, 1000)
      .find((item) => item.type === 'recovery.observed')!;
    assert.equal(
      (event.payload as Record<string, unknown>).business_success,
      false,
    );
    assert.equal(provider.turns.length, 1);
    assert.equal(f.store.records(state.run.id, 'session').length, 1);
    assert.equal(f.store.records(state.run.id, 'final').length, 0);
    assert.deepEqual(f.store.tasks(state.run.id), []);
    assert.deepEqual(f.store.attempts(state.run.id), []);
    assert.deepEqual(provider.failures, []);
  },
);

for (const variant of ['forged_identity', 'intent_without_identity'] as const) {
  test(
    `startup refuses ${variant} without killing an unverified process or starting a model`,
    { timeout: 10_000 },
    async (t) => {
      const provider = new ScriptedProvider(async () => {
        assert.fail('An unreconciled turn cannot launch a replacement model');
      });
      const f = await fixture(t, provider);
      const owned =
        variant === 'forged_identity' ? await ownedProcess(t) : null;
      const identity = owned
        ? { ...owned.identity, command_sha256: '0'.repeat(64) }
        : null;
      const state = crashState(
        f,
        identity,
        variant === 'intent_without_identity',
      );
      f.runtime.initialize();
      assert.equal(f.store.getRun(state.run.id).status, 'waiting_provider');
      assert.equal(provider.turns.length, 0);
      await assert.rejects(
        f.owner.admin({
          method: 'resume',
          arguments: { run_id: state.run.id },
        }),
        hasCode('RECONCILIATION_REQUIRED'),
      );
      assert.equal(provider.turns.length, 0);
      assert.equal(f.store.getRun(state.run.id).status, 'waiting_provider');
      assert.equal(
        f.store.getRecord<Operation>(
          state.run.id,
          'operation',
          state.operation.id,
        ).status,
        variant === 'intent_without_identity' ? 'intent' : 'running',
      );
      if (owned) assert.doesNotThrow(() => process.kill(owned.child.pid!, 0));
      assert.equal(f.store.records(state.run.id, 'final').length, 0);
    },
  );
}

test(
  'isolated deliveries pass but their failed combination requires an explicit corrective mission and fresh reviewed candidate before completion',
  { timeout: 30_000 },
  async (t) => {
    const targetRef = 'refs/heads/crew-corrected-capacity';
    const initialWorkers = barrier(2);
    const trace: string[] = [];
    let phase:
      'plan' | 'initial' | 'correction' | 'reviews' | 'accepted' | 'completed' =
      'plan';
    let baseRevision = '';
    let failed!: IntegrationCandidate;
    let corrected!: IntegrationCandidate;
    const sourceIds = [
      'task:feature-a',
      'task:feature-b',
      'task:capacity-correction',
    ];
    const isolated: IntegrationCandidate[] = [];
    const provider = new ScriptedProvider(async ({ request }) => {
      const api = agent(request),
        status = (await api.status()).result;
      const collect = async (id: string) =>
        (
          await api.call<Collected>('collect_delivery', {
            task_id: id,
            handoff_id: null,
          })
        ).result;
      const prepare = async (deliveries: Collected[], checkId: string) =>
        (
          await api.call<IntegrationCandidate>('propose_integration', {
            handoff_ids: deliveries.map((delivery) => delivery.handoff.id),
            target_ref: targetRef,
            expected_target_revision: baseRevision,
            required_check_ids: [checkId],
          })
        ).result;
      if (request.role === 'chief') {
        if (phase === 'plan') {
          baseRevision = (
            await api.call<{ git: { revision: string } }>('inspect_project', {
              focus: ['**'],
              requested_source_ids: [],
            })
          ).result.git.revision;
          for (const name of ['a', 'b']) {
            const spec: TaskSpec = {
              ...task(status.run, `task:feature-${name}`, 'documenter'),
              role: 'developer',
              objective: `Enable feature ${name} and retain the one-unit resource budget in its isolated delivery`,
              acceptance_criteria: [
                {
                  id: `criterion:feature-${name}`,
                  description: `Feature ${name} enabled and executable in isolation`,
                  required: true,
                  verification: `check:isolated-${name}`,
                },
              ],
              scope: {
                read_paths: ['**'],
                write_paths: [`features/${name}.json`],
                excluded_paths: [],
              },
              base_revision: baseRevision,
              expected_deliverables: [
                `features/${name}.json enabled with a passing isolated check`,
              ],
            };
            await api.call('create_task', { task: spec });
          }
          phase = 'initial';
          for (const name of ['a', 'b'])
            await api.call('delegate_task', {
              task_id: `task:feature-${name}`,
              provider: 'fake',
              model: null,
            });
          await initialWorkers.ready;
          return;
        }
        if (phase === 'initial') {
          if (
            status.tasks
              .filter((item) => sourceIds.slice(0, 2).includes(item.id))
              .some((item) => item.status !== 'in_review')
          )
            return;
          const deliveries = await Promise.all(
            sourceIds.slice(0, 2).map(collect),
          );
          for (const [index, delivery] of deliveries.entries()) {
            const candidate = await prepare(
              [delivery],
              `check:isolated-${index === 0 ? 'a' : 'b'}`,
            );
            assert.equal(candidate.status, 'validated');
            assert.ok(
              candidate.proofs.every(
                (proof) =>
                  proof.exitCode === 0 &&
                  proof.candidateRevision === candidate.candidateRevision,
              ),
            );
            isolated.push(candidate);
            trace.push(`isolated:${index}:passed`);
          }
          failed = await prepare(deliveries, 'check:combined-capacity');
          assert.equal(failed.status, 'validation_failed');
          assert.equal(failed.proofs[0]!.exitCode, 1);
          assert.match(
            failed.proofs[0]!.output,
            /Combined capacity exceeded: 2 > 1/,
          );
          assert.equal(
            git(request.cwd, 'rev-parse', targetRef),
            baseRevision.slice(4),
          );
          trace.push('combined:failed');
          const observed = await collect(sourceIds[0]!);
          await assert.rejects(
            api.call('finish_run', {
              summary: 'Isolated success cannot complete a failed combination',
              criterion_evidence: [
                {
                  criterion_id: status.run.acceptance_criteria[0]!.id,
                  evidence_artifact_ids:
                    observed.verifications[0]!.evidence_artifact_ids,
                },
              ],
              delivered_artifact_ids: deliveries.flatMap((delivery) =>
                delivery.handoff.artifacts.map((artifact) => artifact.id),
              ),
            }),
            hasCode('INVALID_EVIDENCE'),
          );
          assert.equal((await api.status()).result.run.status, 'running');
          const fix: TaskSpec = {
            ...task(status.run, sourceIds[2]!, 'documenter'),
            role: 'developer',
            objective: `Correct failed candidate ${failed.candidateRevision}: serialize application dispatch while keeping both features enabled`,
            acceptance_criteria: [status.run.acceptance_criteria[0]!],
            scope: {
              read_paths: ['**'],
              write_paths: ['policy.json'],
              excluded_paths: [],
            },
            base_revision: failed.candidateRevision,
            expected_deliverables: [
              'policy.json enables serial execution; combined check passes with both features still present',
            ],
          };
          await api.call('create_task', { task: fix });
          await api.call('record_decision', {
            decision_id: 'decision:correct-combined-capacity',
            question:
              'How should the failed combined capacity check be corrected?',
            answer: `Keep both delivered features and the original one-unit criterion; use a dedicated mission based on ${failed.candidateRevision} to serialize dispatch`,
            requested_status: 'approved',
            basis: 'technical_judgment',
            user_response_id: null,
            source_ids: [],
            affects_task_ids: sourceIds,
            supersedes: null,
          });
          phase = 'correction';
          trace.push('correction:requested');
          await api.call('delegate_task', {
            task_id: fix.id,
            provider: 'fake',
            model: null,
          });
          return;
        }
        if (phase === 'correction') {
          if (
            status.tasks.find((item) => item.id === sourceIds[2])?.status !==
            'in_review'
          )
            return;
          const deliveries = await Promise.all(sourceIds.map(collect));
          trace.push('correction:delivered');
          corrected = await prepare(deliveries, 'check:combined-capacity');
          assert.equal(corrected.status, 'validated');
          assert.notEqual(
            corrected.candidateRevision,
            failed.candidateRevision,
          );
          assert.ok(
            corrected.proofs.every(
              (proof) =>
                proof.exitCode === 0 &&
                proof.candidateRevision === corrected.candidateRevision,
            ),
          );
          assert.equal(
            git(request.cwd, 'rev-parse', targetRef),
            baseRevision.slice(4),
          );
          trace.push('combined:corrected');
          phase = 'reviews';
          for (const [index, delivery] of deliveries.entries()) {
            const spec: TaskSpec = {
              ...task(status.run, `task:capacity-review-${index}`, 'reviewer'),
              objective: `Review ${delivery.handoff.task_id} against the corrected exact combined candidate; require both features and peak capacity one`,
              acceptance_criteria: [
                {
                  id: `criterion:capacity-review-${index}`,
                  description:
                    'Current source and corrected combined result independently inspected',
                  required: true,
                  verification: 'Canonical review snapshot',
                },
              ],
              scope: {
                read_paths: ['**'],
                write_paths: [],
                excluded_paths: [],
              },
              base_revision: corrected.candidateRevision,
              expected_deliverables: [
                `Approved or changes_requested Review for ${delivery.handoff.id} on ${corrected.candidateRevision}`,
              ],
            };
            await api.call('create_task', { task: spec });
            await api.call('delegate_task', {
              task_id: spec.id,
              provider: 'fake',
              model: null,
            });
          }
          return;
        }
        if (phase === 'reviews' || phase === 'accepted') {
          const deliveries = await Promise.all(sourceIds.map(collect));
          if (phase === 'reviews') {
            if (
              deliveries.some(
                (delivery) =>
                  !delivery.reviews.some(
                    (review) =>
                      review.outcome === 'approved' &&
                      review.tested_revision === corrected.candidateRevision,
                  ),
              )
            )
              return;
            trace.push('reviews:approved');
            for (const delivery of deliveries) {
              const review = delivery.reviews.find(
                (item) =>
                  item.outcome === 'approved' &&
                  item.tested_revision === corrected.candidateRevision,
              )!;
              const proofs = delivery.verifications.filter(
                (proof) =>
                  proof.tested_revision === corrected.candidateRevision,
              );
              assert.ok(proofs.length);
              assert.equal(
                (
                  await api.call<TaskState>('accept_delivery', {
                    handoff_id: delivery.handoff.id,
                    review_ids: [review.id],
                    verification_ids: proofs.map((proof) => proof.id),
                    accepted_revision: corrected.candidateRevision,
                  })
                ).result.status,
                'accepted',
              );
            }
            phase = 'accepted';
            trace.push('deliveries:accepted');
          }
          const proof = deliveries[2]!.verifications.find(
            (item) => item.tested_revision === corrected.candidateRevision,
          )!;
          try {
            const final = (
              await api.call<Run>('finish_run', {
                summary:
                  'Failed combination corrected without dropping a feature or weakening the one-unit criterion; providers simulated',
                criterion_evidence: [
                  {
                    criterion_id: status.run.acceptance_criteria[0]!.id,
                    evidence_artifact_ids: proof.evidence_artifact_ids,
                  },
                ],
                delivered_artifact_ids: deliveries.flatMap((delivery) =>
                  delivery.handoff.artifacts.map((artifact) => artifact.id),
                ),
              })
            ).result;
            assert.equal(final.status, 'completed');
            phase = 'completed';
            trace.push('run:completed');
          } catch (error) {
            if (!(error instanceof CrewError) || error.code !== 'RUN_BUSY')
              throw error;
            // The last review's physical turn must exit before the next chief can finish.
          }
          return;
        }
        assert.fail('Unexpected chief turn after verified completion');
      }
      const own = status.tasks[0]!;
      if (request.role === 'developer') {
        if (own.id === sourceIds[2]) {
          assert.equal(
            `git:${git(request.cwd, 'rev-parse', 'HEAD')}`,
            failed.candidateRevision,
          );
          assert.ok(
            JSON.parse(
              readFileSync(join(request.cwd, 'features/a.json'), 'utf8'),
            ).enabled,
          );
          assert.ok(
            JSON.parse(
              readFileSync(join(request.cwd, 'features/b.json'), 'utf8'),
            ).enabled,
          );
          writeFileSync(
            join(request.cwd, 'policy.json'),
            JSON.stringify({ mode: 'serial' }),
          );
          const plan = JSON.parse(
            execFileSync(process.execPath, ['check.mjs'], {
              cwd: request.cwd,
              encoding: 'utf8',
            }),
          );
          assert.deepEqual(plan.enabled, ['a', 'b']);
          assert.equal(plan.peak, 1);
        } else {
          const feature = own.id.endsWith('-a') ? 'a' : 'b';
          await initialWorkers.enter();
          writeFileSync(
            join(request.cwd, `features/${feature}.json`),
            JSON.stringify({ enabled: true }),
          );
          const plan = JSON.parse(
            execFileSync(
              process.execPath,
              ['check.mjs', `--feature=${feature}`],
              { cwd: request.cwd, encoding: 'utf8' },
            ),
          );
          assert.deepEqual(plan.enabled, [feature]);
          assert.equal(plan.peak, 1);
        }
        const handoff: Handoff = {
          schema_version: 1,
          id: `handoff:${own.id}`,
          task_id: own.id,
          run_id: api.runId,
          attempt_id: own.active_attempt_id!,
          generation: own.generation,
          status: 'delivered',
          summary: 'Actual checked code/configuration snapshot',
          source_revision: null,
          artifacts: [],
          verifications: [],
          criteria_claimed: own.spec.acceptance_criteria.map(
            (criterion) => criterion.id,
          ),
          limitations: [],
          next_information: [],
          created_at: now(),
        };
        await api.call('submit_handoff', { handoff });
        return;
      }
      assert.equal(request.role, 'reviewer');
      assert.equal(
        `git:${git(request.cwd, 'rev-parse', 'HEAD')}`,
        corrected.candidateRevision,
      );
      const plan = JSON.parse(
        execFileSync(process.execPath, ['check.mjs'], {
          cwd: request.cwd,
          encoding: 'utf8',
        }),
      );
      assert.deepEqual(plan.enabled, ['a', 'b']);
      assert.deepEqual(plan.batches, [['a'], ['b']]);
      const index = Number(own.id.slice('task:capacity-review-'.length));
      const delivery = await collect(sourceIds[index]!);
      const proofs = delivery.verifications.filter(
        (proof) => proof.tested_revision === corrected.candidateRevision,
      );
      assert.ok(proofs.length);
      assert.ok(
        proofs.every(
          (proof) => proof.result === 'passed' && proof.exit_code === 0,
        ),
      );
      const review: Review = {
        schema_version: 1,
        id: `review:capacity-${index}`,
        run_id: api.runId,
        review_task_id: own.id,
        review_of_task_id: delivery.handoff.task_id,
        handoff_id: delivery.handoff.id,
        outcome: 'approved',
        verification_scope: 'combined_code',
        source_revision: delivery.handoff.source_revision!,
        tested_revision: corrected.candidateRevision,
        summary:
          'Both features remain enabled and execute once with peak capacity one on the corrected combined candidate',
        findings: [],
        verification_ids: proofs.map((proof) => proof.id),
        created_at: now(),
      };
      await api.call('submit_review', { review });
    });
    const f = await fixture(t, provider, 3, 'code');
    mkdirSync(join(f.root, 'features'));
    for (const name of ['a', 'b'])
      writeFileSync(
        join(f.root, `features/${name}.json`),
        JSON.stringify({ enabled: false }),
      );
    writeFileSync(
      join(f.root, 'policy.json'),
      JSON.stringify({ mode: 'parallel' }),
    );
    for (const [fixtureName, target] of [
      ['capacity-app.mjs', 'app.mjs'],
      ['capacity-check.mjs', 'check.mjs'],
    ])
      writeFileSync(
        join(f.root, target!),
        readFileSync(
          new URL(
            `../../tests/fixtures/runtime/${fixtureName}`,
            import.meta.url,
          ),
        ),
      );
    git(f.root, 'add', '--all');
    git(
      f.root,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@localhost',
      'commit',
      '-m',
      'capacity application baseline',
    );
    const initial = git(f.root, 'rev-parse', 'HEAD');
    f.store.configureProject({
      ...f.store.project.config,
      verification_commands: [
        {
          id: 'check:isolated-a',
          argv: [process.execPath, 'check.mjs', '--feature=a'],
          cwd: '.',
          timeout_seconds: 10,
        },
        {
          id: 'check:isolated-b',
          argv: [process.execPath, 'check.mjs', '--feature=b'],
          cwd: '.',
          timeout_seconds: 10,
        },
        {
          id: 'check:combined-capacity',
          argv: [process.execPath, 'check.mjs'],
          cwd: '.',
          timeout_seconds: 10,
        },
      ],
    });
    writeFileSync(
      join(f.root, 'user-note.txt'),
      'Preserve the principal checkout and this uncommitted note',
    );
    const run = (await f.owner.admin({
      method: 'create_run',
      arguments: {
        objective:
          'Enable both application features and execute each exactly once without exceeding one unit of simultaneous capacity',
        criteria: [
          'Both features remain enabled, each runs exactly once, and combined peak capacity is at most one',
        ],
        constraints: [
          'Do not remove a feature or weaken the shared budget to obtain success',
        ],
        chief_provider: 'fake',
        chief_model: null,
        max_active_agents: 3,
        delivery_mode: 'code',
      },
    })) as Run;
    try {
      await f.completed(run.id);
    } catch (error) {
      throw new Error(
        `Correction workflow stopped in phase ${phase} after ${trace.join(', ')}; configured context budget=${f.store.project.config.context.input_budget_tokens}`,
        { cause: error },
      );
    }
    assert.deepEqual(trace, [
      'isolated:0:passed',
      'isolated:1:passed',
      'combined:failed',
      'correction:requested',
      'correction:delivered',
      'combined:corrected',
      'reviews:approved',
      'deliveries:accepted',
      'run:completed',
    ]);
    assert.equal(phase, 'completed');
    assert.deepEqual(provider.failures, []);
    assert.equal(isolated.length, 2);
    assert.ok(provider.peak <= 3);
    assert.equal(
      git(f.root, 'rev-parse', targetRef),
      corrected.candidateRevision.slice(4),
    );
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), initial);
    assert.equal(
      readFileSync(join(f.root, 'user-note.txt'), 'utf8'),
      'Preserve the principal checkout and this uncommitted note',
    );
    assert.equal(
      JSON.parse(git(f.root, 'show', `${targetRef}:policy.json`)).mode,
      'serial',
    );
    for (const name of ['a', 'b'])
      assert.equal(
        JSON.parse(git(f.root, 'show', `${targetRef}:features/${name}.json`))
          .enabled,
        true,
      );
    assert.equal(
      JSON.parse(readFileSync(join(failed.path, 'policy.json'), 'utf8')).mode,
      'parallel',
    );
    assert.ok(
      existsSync(failed.path),
      'The failed candidate remains inspectable',
    );
    const operations = f.store
      .records<Operation>(run.id, 'operation')
      .filter((operation) => operation.kind === 'integration.prepare');
    assert.equal(operations.length, 4);
    assert.equal(
      (
        operations.find((operation) => operation.id === failed.operationId)!
          .result as IntegrationCandidate
      ).status,
      'validation_failed',
    );
    const proofs = f.store.records<Verification>(run.id, 'verification');
    assert.ok(
      !proofs.some(
        (proof) =>
          proof.tested_revision === failed.candidateRevision &&
          proof.result === 'passed',
      ),
    );
    const final = f.store.getRun(run.id);
    assert.equal(final.status, 'completed');
    assert.deepEqual(final.acceptance_criteria, run.acceptance_criteria);
    assert.deepEqual(final.constraints, run.constraints);
    assert.equal(f.store.tasks(run.id).length, 6);
    assert.ok(
      f.store.tasks(run.id).every((item) => item.status === 'accepted'),
    );
    assert.equal(
      f.store.getTask(sourceIds[2]!).spec.base_revision,
      failed.candidateRevision,
    );
    assert.equal(
      f.store.records<Decision>(run.id, 'decision')[0]!.id,
      'decision:correct-combined-capacity',
    );
  },
);
