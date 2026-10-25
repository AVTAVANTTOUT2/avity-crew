import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { CrewError, now } from '../packages/contracts/src/index.ts';
import type {
  Actor,
  AgentSession,
  Handoff,
  Review,
  Run,
  TaskSpec,
  ToolCall,
} from '../packages/contracts/src/index.ts';
import { identifyProject, Store } from '../packages/storage/src/index.ts';
import { WorkspaceManager } from '../packages/workspace/src/index.ts';
import type { IntegrationCandidate } from '../packages/workspace/src/index.ts';
import { CapabilityRegistry } from '../packages/supervisor/src/capabilities.ts';
import { SupervisorClient } from '../packages/supervisor/src/client.ts';
import { Coordinator } from '../packages/supervisor/src/coordinator.ts';
import type { TransportHandle } from '../packages/supervisor/src/protocol.ts';
import { startTransport } from '../packages/supervisor/src/transport.ts';

type Outcome = { ok: true; result: unknown } | { ok: false; error: unknown };

test(
  'a capability revoked while an authenticated HTTP mutation is queued cannot mutate when the queue resumes',
  { timeout: 10_000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'avity queued authority '));
    const root = join(directory, 'project');
    mkdirSync(root);
    const store = new Store(
      identifyProject(root, join(directory, 'private-data')),
    );
    const registry = new CapabilityRegistry(store);
    const coordinator = new Coordinator(store, {
      wake: () => {},
      admin: async () => {
        throw new Error(
          'No runtime administration or model is used by this fixture',
        );
      },
    });

    let release!: () => void;
    const previousMutation = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Delay the existing mutation queue as if an earlier operation were pending.
    // Authentication, tools, dispatch and Store mutations remain production code.
    (coordinator as unknown as { tail: Promise<unknown> }).tail =
      previousMutation;
    let markQueued!: () => void;
    const queued = new Promise<void>((resolve) => {
      markQueued = resolve;
    });
    let transport: TransportHandle | undefined;
    let pending: Promise<Outcome> | undefined;
    t.after(async () => {
      release();
      await pending;
      await transport?.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    });

    const timestamp = now();
    const run: Run = {
      id: 'run:queued-authority',
      project_id: store.project.id,
      objective: 'Reject authority that expires while an HTTP request waits',
      constraints: ['This fixture never starts a model'],
      acceptance_criteria: [
        {
          id: 'AC:no-expired-mutation',
          description: 'No queued domain write survives capability revocation',
          required: true,
          verification: 'Real Registry, HTTP, coordinator queue and SQLite',
        },
      ],
      delivery_mode: 'documentation',
      status: 'planning',
      chief_provider: 'fake',
      chief_model: null,
      generation: 1,
      version: 0,
      max_active_agents: 1,
      created_at: timestamp,
      updated_at: timestamp,
    };
    store.createRun(run, 'test:create-run');
    const actor: Actor = {
      id: 'chief:queued-authority',
      project_id: store.project.id,
      run_id: run.id,
      role: 'chief',
      task_id: null,
      attempt_id: null,
      generation: run.generation,
    };
    const token = registry.issue(actor);
    transport = await startTransport({
      directory: store.project.data_dir,
      project_id: store.project.id,
      registry,
      api: {
        tools: (principal, runId) => coordinator.tools(principal, runId),
        execute: (principal, call) => {
          const result = coordinator.execute(principal, call);
          // This is reached only after HTTP authenticated the real capability,
          // and execute has chained this mutation behind previousMutation.
          markQueued();
          return result;
        },
        admin: (principal, request) => coordinator.admin(principal, request),
      },
    });
    const client = new SupervisorClient({
      endpointFile: transport.endpointFile,
      capability: token,
    });
    const task: TaskSpec = {
      schema_version: 1,
      id: 'task:must-not-exist',
      run_id: run.id,
      title: 'A revoked queued request must not create this task',
      objective: 'Keep the domain unchanged after revocation',
      role: 'documenter',
      acceptance_criteria: [run.acceptance_criteria[0]!],
      depends_on: [],
      scope: { read_paths: [], write_paths: [], excluded_paths: [] },
      base_revision: null,
      context_source_ids: [],
      expected_deliverables: ['No write from expired authority'],
      created_at: timestamp,
    };
    const beforeRun = store.getRun(run.id);
    const beforeEvents = store.events(run.id, 0, 100);
    const action: ToolCall = {
      schema_version: 1,
      request_id: 'request:queued-before-revoke',
      idempotency_key: 'action:queued-before-revoke',
      run_id: run.id,
      expected_version: beforeRun.version,
      method: 'create_task',
      arguments: { task },
    };
    pending = client.execute(action).then(
      (result): Outcome => ({ ok: true, result }),
      (error: unknown): Outcome => ({ ok: false, error }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        queued,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error('The authenticated request never reached the queue'),
              ),
            2_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    assert.deepEqual(store.tasks(run.id), []);
    assert.deepEqual(store.getRun(run.id), beforeRun);

    registry.revoke(token);
    assert.throws(() => registry.authenticate(token), { code: 'FORBIDDEN' });
    assert.equal(store.getRun(run.id).generation, actor.generation);
    release();
    const outcome = await pending;

    assert.deepEqual(
      store.tasks(run.id),
      [],
      'Revocation while queued must prevent task creation after queue release',
    );
    assert.deepEqual(store.getRun(run.id), beforeRun);
    assert.deepEqual(store.records(run.id, 'operation'), []);
    assert.deepEqual(store.events(run.id, 0, 100), beforeEvents);
    if (outcome.ok)
      assert.fail('Expired authority must produce an HTTP denial');
    assert.ok(outcome.error instanceof CrewError);
    assert.ok(
      ['FORBIDDEN', 'REVOKED_CAPABILITY', 'STALE_AUTHORITY'].includes(
        outcome.error.code,
      ),
    );
  },
);

async function codeAuthorityFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'avity promotion authority '));
  const root = join(directory, 'project with spaces');
  mkdirSync(root);
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '--initial-branch=main');
  writeFileSync(join(root, 'baseline.txt'), 'Preserved baseline\n');
  git('add', '--all');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@localhost',
    'commit',
    '-m',
    'baseline',
  );
  const baseline = git('rev-parse', 'HEAD');
  const project = identifyProject(root, join(directory, 'private-data'));
  const store = new Store(project);
  const registry = new CapabilityRegistry(store);
  const coordinator = new Coordinator(store, {
    wake: () => {},
    admin: async () => {
      throw new Error(
        'No runtime administration or model is used by this fixture',
      );
    },
  });
  let transport: TransportHandle | undefined;
  const cleanup = {
    pending: undefined as Promise<Outcome> | undefined,
    release: () => {},
    restore: () => {},
  };
  t.after(async () => {
    cleanup.release();
    await cleanup.pending;
    cleanup.restore();
    await transport?.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let sequence = 0;
  const key = () => `probe:promotion-${++sequence}`;
  const version = () => store.getRun(run.id).version;
  const timestamp = now();
  const run: Run = {
    id: 'run:promotion-authority',
    project_id: project.id,
    objective:
      'Keep a verified delivery ref unchanged after capability revocation',
    constraints: [
      'No provider is launched; only fixture Git processes are used',
    ],
    acceptance_criteria: [
      {
        id: 'AC:write',
        description: 'Capture the actual fixture change',
        required: true,
        verification: 'Git snapshot and diff check',
      },
      {
        id: 'AC:review',
        description: 'Independently review the exact combination',
        required: true,
        verification: 'Observed fixture review result',
      },
    ],
    delivery_mode: 'code',
    status: 'planning',
    chief_provider: 'fake',
    chief_model: null,
    generation: 1,
    version: 0,
    max_active_agents: 1,
    created_at: timestamp,
    updated_at: timestamp,
  };
  store.createRun(run, key());
  const user: Actor = {
    id: 'user:local',
    project_id: project.id,
    run_id: run.id,
    role: 'user',
    task_id: null,
    attempt_id: null,
    generation: 1,
  };
  const chief: Actor = { ...user, id: 'chief:promotion', role: 'chief' };
  const writerSpec: TaskSpec = {
    schema_version: 1,
    id: 'task:promotion-writer',
    run_id: run.id,
    title: 'Write the fixture change',
    objective: 'Produce an immutable code snapshot',
    role: 'developer',
    acceptance_criteria: [run.acceptance_criteria[0]!],
    depends_on: [],
    scope: { read_paths: ['**'], write_paths: ['**'], excluded_paths: [] },
    base_revision: `git:${baseline}`,
    context_source_ids: [],
    expected_deliverables: ['Checked fixture snapshot'],
    created_at: timestamp,
  };
  store.createTask(user, writerSpec, key(), version());
  const writerSession: AgentSession = {
    id: 'session:promotion-writer',
    run_id: run.id,
    task_id: writerSpec.id,
    provider: 'fake',
    model: null,
    native_session_id: 'simulated:writer',
    cli_version: 'fixture',
    cwd: root,
    capabilities: null,
  };
  const writerAttempt = store.claimTask(
    user,
    writerSpec.id,
    writerSession,
    key(),
    version(),
  );
  // These are trusted fixture observations, never a claim of an LLM turn.
  store.observeAttempt(
    user,
    writerAttempt.id,
    { status: 'running', pid: null, exit_code: null },
    key(),
    version(),
  );
  const writer: Actor = {
    ...user,
    id: writerSession.id,
    role: 'developer',
    task_id: writerSpec.id,
    attempt_id: writerAttempt.id,
    generation: writerAttempt.generation,
  };
  const manager = new WorkspaceManager(store, user);
  const workspace = await manager.createWorkspace(
    {
      taskId: writerSpec.id,
      attemptId: writerAttempt.id,
      mode: 'code',
      baseRevision: writerSpec.base_revision,
    },
    key(),
  );
  writeFileSync(
    join(workspace.path, 'feature.txt'),
    'Actual reviewed fixture change\n',
  );
  const delivery = await manager.collectDelivery(
    workspace.operationId,
    { writePaths: ['**'] },
    key(),
  );
  assert.ok(delivery.preservationRef);
  const handoff: Handoff = {
    schema_version: 1,
    id: 'handoff:promotion-writer',
    run_id: run.id,
    task_id: writerSpec.id,
    attempt_id: writerAttempt.id,
    generation: writerAttempt.generation,
    status: 'delivered',
    summary: 'Actual immutable fixture source',
    source_revision: delivery.sourceRevision,
    artifacts: [
      {
        id: 'artifact:promotion-source',
        kind: 'git_commit',
        reference: delivery.preservationRef,
        revision: delivery.sourceRevision,
        producer_attempt_id: writerAttempt.id,
        created_at: timestamp,
      },
    ],
    verifications: [],
    criteria_claimed: [run.acceptance_criteria[0]!.id],
    limitations: [],
    next_information: [],
    created_at: timestamp,
  };
  store.submitHandoff(writer, handoff, key(), version());
  store.observeAttempt(
    user,
    writerAttempt.id,
    { status: 'exited', pid: null, exit_code: 0 },
    key(),
    version(),
  );
  const token = registry.issue(chief);
  transport = await startTransport({
    directory: project.data_dir,
    project_id: project.id,
    registry,
    api: coordinator,
  });
  const client = new SupervisorClient({
    endpointFile: transport.endpointFile,
    capability: token,
  });
  const targetRef = 'refs/heads/authority-delivery';
  const proposal: Extract<ToolCall, { method: 'propose_integration' }> = {
    schema_version: 1,
    request_id: key(),
    idempotency_key: key(),
    run_id: run.id,
    expected_version: version(),
    method: 'propose_integration',
    arguments: {
      handoff_ids: [handoff.id],
      target_ref: targetRef,
      expected_target_revision: `git:${baseline}`,
      required_check_ids: ['check:git-diff'],
    },
  };

  return {
    store,
    registry,
    run,
    user,
    writerSpec,
    writerSession,
    delivery,
    handoff,
    client,
    token,
    targetRef,
    proposal,
    baseline,
    git,
    key,
    version,
    timestamp,
    cleanup,
  };
}

test(
  'revocation during an awaited promotion denies the action without advancing its real Git delivery ref',
  { timeout: 20_000 },
  async (t) => {
    const {
      store,
      registry,
      run,
      user,
      writerSpec,
      writerSession,
      delivery,
      handoff,
      client,
      token,
      targetRef,
      proposal,
      baseline,
      git,
      key,
      version,
      timestamp,
      cleanup,
    } = await codeAuthorityFixture(t);
    const originalPromotion = WorkspaceManager.prototype.promoteIntegration;
    cleanup.restore = () => {
      WorkspaceManager.prototype.promoteIntegration = originalPromotion;
    };
    const candidate = (
      (await client.execute(proposal)) as { result: IntegrationCandidate }
    ).result;
    assert.equal(candidate.status, 'validated');
    assert.notEqual(candidate.candidateRevision, `git:${baseline}`);
    const reviewerSpec: TaskSpec = {
      ...writerSpec,
      id: 'task:promotion-reviewer',
      title: 'Review the exact candidate',
      objective: 'Review the immutable combination',
      role: 'reviewer',
      acceptance_criteria: [run.acceptance_criteria[1]!],
      scope: { read_paths: ['**'], write_paths: [], excluded_paths: [] },
      base_revision: candidate.candidateRevision,
    };
    store.createTask(user, reviewerSpec, key(), version());
    const reviewerSession: AgentSession = {
      ...writerSession,
      id: 'session:promotion-reviewer',
      task_id: reviewerSpec.id,
      native_session_id: 'simulated:independent-reviewer',
    };
    const reviewerAttempt = store.claimTask(
      user,
      reviewerSpec.id,
      reviewerSession,
      key(),
      version(),
    );
    store.observeAttempt(
      user,
      reviewerAttempt.id,
      { status: 'running', pid: null, exit_code: null },
      key(),
      version(),
    );
    const reviewer: Actor = {
      ...user,
      id: reviewerSession.id,
      role: 'reviewer',
      task_id: reviewerSpec.id,
      attempt_id: reviewerAttempt.id,
      generation: reviewerAttempt.generation,
    };
    const proofIds = store
      .records<{ id: string }>(run.id, 'verification')
      .map((proof) => proof.id);
    const review: Review = {
      schema_version: 1,
      id: 'review:promotion',
      run_id: run.id,
      review_task_id: reviewerSpec.id,
      review_of_task_id: writerSpec.id,
      handoff_id: handoff.id,
      outcome: 'approved',
      verification_scope: 'combined_code',
      source_revision: delivery.sourceRevision,
      tested_revision: candidate.candidateRevision,
      summary: 'Independent fixture review of the real checked combination',
      findings: [],
      verification_ids: proofIds,
      created_at: timestamp,
    };
    store.submitReview(reviewer, review, key(), version());
    store.observeAttempt(
      user,
      reviewerAttempt.id,
      { status: 'exited', pid: null, exit_code: 0 },
      key(),
      version(),
    );

    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      cleanup.release = resolve;
    });
    // Pause before the real promotion performs its async Git reads or writes.
    // All evidence, review, auth and promotion logic below remain production code.
    WorkspaceManager.prototype.promoteIntegration = async function (
      this: WorkspaceManager,
      ...args: Parameters<WorkspaceManager['promoteIntegration']>
    ) {
      markEntered();
      await gate;
      return originalPromotion.apply(this, args);
    };
    const action: Extract<ToolCall, { method: 'accept_delivery' }> = {
      schema_version: 1,
      request_id: key(),
      idempotency_key: key(),
      run_id: run.id,
      expected_version: version(),
      method: 'accept_delivery',
      arguments: {
        handoff_id: handoff.id,
        review_ids: [review.id],
        verification_ids: proofIds as [string, ...string[]],
        accepted_revision: candidate.candidateRevision,
      },
    };
    cleanup.pending = client.execute(action).then(
      (result): Outcome => ({ ok: true, result }),
      (error: unknown): Outcome => ({ ok: false, error }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        entered,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('The verified action never reached promotion')),
            2_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    assert.equal(git('rev-parse', targetRef), baseline);
    registry.revoke(token);
    assert.throws(() => registry.authenticate(token), { code: 'FORBIDDEN' });
    cleanup.release();
    const outcome = await cleanup.pending;

    assert.equal(
      git('rev-parse', targetRef),
      baseline,
      'Revocation during promotion must leave the actual delivery ref unchanged',
    );
    assert.equal(store.getTask(run.id, writerSpec.id).status, 'in_review');
    assert.deepEqual(store.records(run.id, 'acceptance'), []);
    if (outcome.ok)
      assert.fail('A revoked promotion must return an HTTP denial');
    assert.ok(outcome.error instanceof CrewError);
    assert.ok(
      ['FORBIDDEN', 'REVOKED_CAPABILITY', 'STALE_AUTHORITY'].includes(
        outcome.error.code,
      ),
    );
  },
);

test(
  'revocation during integration preparation denies the action without publishing checks or changing delivery refs',
  { timeout: 20_000 },
  async (t) => {
    const f = await codeAuthorityFixture(t);
    const originalPreparation = WorkspaceManager.prototype.prepareIntegration;
    f.cleanup.restore = () => {
      WorkspaceManager.prototype.prepareIntegration = originalPreparation;
    };
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      f.cleanup.release = resolve;
    });
    WorkspaceManager.prototype.prepareIntegration = async function (
      this: WorkspaceManager,
      ...args: Parameters<WorkspaceManager['prepareIntegration']>
    ) {
      markEntered();
      await gate;
      return originalPreparation.apply(this, args);
    };
    const refsBefore = f.git(
      'for-each-ref',
      '--format=%(objectname)',
      f.targetRef,
    );
    assert.equal(refsBefore, '');
    assert.deepEqual(f.store.records(f.run.id, 'verification'), []);
    f.cleanup.pending = f.client.execute(f.proposal).then(
      (result): Outcome => ({ ok: true, result }),
      (error: unknown): Outcome => ({ ok: false, error }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        entered,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('Preparation never reached its async boundary')),
            2_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    f.registry.revoke(f.token);
    assert.throws(() => f.registry.authenticate(f.token), {
      code: 'FORBIDDEN',
    });
    f.cleanup.release();
    const outcome = await f.cleanup.pending;
    assert.deepEqual(
      f.store.records(f.run.id, 'verification'),
      [],
      'Revoked preparation must not publish verification evidence after its await',
    );
    assert.equal(
      f.git('for-each-ref', '--format=%(objectname)', f.targetRef),
      refsBefore,
      'Revoked preparation must not create or change its Git delivery ref',
    );
    assert.equal(
      f.store.getTask(f.writerSpec.run_id, f.writerSpec.id).status,
      'in_review',
    );
    if (outcome.ok)
      assert.fail('Revoked preparation must return an HTTP denial');
    assert.ok(outcome.error instanceof CrewError);
    assert.ok(
      ['FORBIDDEN', 'REVOKED_CAPABILITY', 'STALE_AUTHORITY'].includes(
        outcome.error.code,
      ),
    );
  },
);
