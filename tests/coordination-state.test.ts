import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, identifyProject } from '../packages/storage/src/index.ts';
import { WorkspaceManager } from '../packages/workspace/src/index.ts';
import { CrewError, now } from '../packages/contracts/src/index.ts';
import type {
  Actor,
  Run,
  TaskSpec,
  AgentSession,
  Handoff,
  Review,
  ArtifactRef,
  Verification,
  AcceptDeliveryArgs,
  FinishRunArgs,
  Decision,
  Delegation,
} from '../packages/contracts/src/index.ts';

const code = (expected: string) => (error: unknown) =>
  error instanceof CrewError && error.code === expected;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();

function fixture(t: TestContext, mode: Run['delivery_mode'] = 'documentation') {
  const directory = mkdtempSync(join(tmpdir(), 'crew coordination '));
  const root = join(directory, 'project with spaces');
  mkdirSync(root);
  if (mode === 'code') {
    git(root, 'init', '--initial-branch=main');
    writeFileSync(join(root, 'base.txt'), 'base');
    git(root, 'add', '--all');
    git(
      root,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@localhost',
      'commit',
      '-m',
      'base',
    );
  }
  const project = identifyProject(root, join(directory, 'data'));
  const store = new Store(project);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const run: Run = {
    id: 'run:coordination',
    project_id: project.id,
    objective: 'Verify coordination invariants',
    constraints: [],
    acceptance_criteria: [
      {
        id: 'criterion:result',
        description: 'Verified accepted result',
        required: true,
        verification: 'test',
      },
    ],
    delivery_mode: mode,
    status: 'planning',
    chief_provider: 'codex',
    chief_model: null,
    generation: 1,
    version: 0,
    max_active_agents: 3,
    created_at: now(),
    updated_at: now(),
  };
  store.createRun(run, 'run:create');
  const user: Actor = {
    id: 'user:local',
    project_id: project.id,
    run_id: run.id,
    role: 'user',
    task_id: null,
    attempt_id: null,
    generation: 1,
  };
  const chief: Actor = { ...user, id: 'chief:local', role: 'chief' };
  const version = () => store.getRun(run.id).version;
  let sequence = 0;
  const key = () => `request:${++sequence}`;
  const task = (
    id: string,
    role: TaskSpec['role'] = 'documenter',
    depends: string[] = [],
  ) => {
    const spec: TaskSpec = {
      schema_version: 1,
      id,
      run_id: run.id,
      title: id,
      objective: 'Produce a fixture result',
      role,
      acceptance_criteria: [run.acceptance_criteria[0]!],
      depends_on: depends,
      scope: { read_paths: ['**'], write_paths: ['**'], excluded_paths: [] },
      base_revision:
        mode === 'code' ? `git:${git(root, 'rev-parse', 'HEAD')}` : null,
      context_source_ids: [],
      expected_deliverables: ['Immutable result'],
      created_at: now(),
    };
    store.createTask(user, spec, key(), version());
    return spec;
  };
  const session = (taskId: string | null): AgentSession => ({
    id: `session:${++sequence}`,
    run_id: run.id,
    task_id: taskId,
    provider: 'codex',
    model: null,
    native_session_id: null,
    cli_version: null,
    cwd: root,
    capabilities: null,
  });
  const claim = (spec: TaskSpec) => {
    const attempt = store.claimTask(
      user,
      spec.id,
      session(spec.id),
      key(),
      version(),
    );
    store.observeAttempt(
      user,
      attempt.id,
      { status: 'running', pid: null, exit_code: null },
      key(),
      version(),
    );
    const actor: Actor = {
      ...user,
      id: `worker:${spec.id}`,
      role: spec.role,
      task_id: spec.id,
      attempt_id: attempt.id,
      generation: attempt.generation,
    };
    return { attempt: store.getAttempt(attempt.id), actor };
  };
  const stop = (attemptId: string) =>
    store.observeAttempt(
      user,
      attemptId,
      { status: 'exited', pid: null, exit_code: 0 },
      key(),
      version(),
    );
  const artifact = (
    attemptId: string,
    id: string,
    content = id,
    kind: ArtifactRef['kind'] = 'report',
  ): ArtifactRef => ({
    id,
    kind,
    ...store.writeArtifact(content),
    producer_attempt_id: attemptId,
    created_at: now(),
  });
  const proof = (
    attemptId: string,
    taskId: string,
    revision: string,
    id = `proof:${++sequence}`,
  ) => {
    const log = artifact(
      attemptId,
      `artifact:${++sequence}`,
      'Observed document inspection',
      'test_log',
    );
    const value: Verification = {
      id,
      criterion_ids: ['criterion:result'],
      mode: 'static',
      execution: 'manual',
      command: null,
      cwd: root,
      result: 'passed',
      exit_code: null,
      tested_revision: revision,
      evidence_artifact_ids: [log.id],
      started_at: now(),
      ended_at: now(),
      provider: null,
    };
    store.saveVerification(user, taskId, value, key(), version(), [log]);
    return { value, log };
  };
  const deliver = (
    spec: TaskSpec,
    writer: ReturnType<typeof claim>,
    overrides: Partial<Handoff> = {},
  ) => {
    const result = artifact(
      writer.attempt.id,
      `artifact:${++sequence}`,
      'Actual documentary snapshot',
    );
    const handoff: Handoff = {
      schema_version: 1,
      id: `handoff:${++sequence}`,
      task_id: spec.id,
      run_id: run.id,
      attempt_id: writer.attempt.id,
      generation: writer.attempt.generation,
      status: 'delivered',
      summary: 'Result ready for independent review',
      source_revision: result.revision,
      artifacts: [result],
      verifications: [],
      criteria_claimed: ['criterion:result'],
      limitations: [],
      next_information: [],
      created_at: now(),
      ...overrides,
    };
    store.submitHandoff(writer.actor, handoff, key(), version());
    return handoff;
  };
  const review = (
    handoff: Handoff,
    verificationIds: string[],
    overrides: Partial<Review> = {},
  ) => {
    const spec = task(`task:review${++sequence}`, 'reviewer');
    const reviewer = claim(spec);
    const value: Review = {
      schema_version: 1,
      id: `review:${++sequence}`,
      run_id: run.id,
      review_task_id: spec.id,
      review_of_task_id: handoff.task_id,
      handoff_id: handoff.id,
      outcome: 'approved',
      verification_scope: 'documentation',
      source_revision: handoff.source_revision!,
      tested_revision: handoff.source_revision,
      summary: 'Inspected the immutable snapshot',
      findings: [],
      verification_ids: verificationIds,
      created_at: now(),
      ...overrides,
    };
    store.submitReview(reviewer.actor, value, key(), version());
    stop(reviewer.attempt.id);
    return value;
  };
  const ready = () => {
    const spec = task('task:result');
    const writer = claim(spec),
      handoff = deliver(spec, writer);
    stop(writer.attempt.id);
    const evidence = proof(
      writer.attempt.id,
      spec.id,
      handoff.source_revision!,
    );
    const control = review(handoff, [evidence.value.id]);
    const args: AcceptDeliveryArgs = {
      handoff_id: handoff.id,
      review_ids: [control.id],
      verification_ids: [evidence.value.id],
      accepted_revision: handoff.source_revision!,
    };
    return { spec, writer, handoff, evidence, control, args };
  };
  return {
    directory,
    root,
    project,
    store,
    run,
    user,
    chief,
    version,
    key,
    task,
    session,
    claim,
    stop,
    artifact,
    proof,
    deliver,
    review,
    ready,
  };
}

test('chief session has no DAG task; replacement revokes old authority without changing domain version for observations', (t) => {
  const f = fixture(t),
    session = f.session(null);
  f.store.registerChiefSession(f.user, session, f.key(), f.version());
  assert.deepEqual(f.store.tasks(f.run.id), []);
  assert.deepEqual(f.store.attempts(f.run.id), []);
  const v = f.version();
  const event = f.store.observation(
    f.user,
    'provider.output',
    { text: 'waiting quietly' },
    { session_id: session.id },
  );
  assert.equal(f.version(), v);
  assert.equal(event.session_id, session.id);
  assert.throws(
    () => f.store.observation(f.user, 'task.accepted', {}),
    code('INVALID_OBSERVATION'),
  );
  const replacement = f.store.replaceChief(
    f.user,
    'claude',
    'model:fixture',
    f.key(),
    f.version(),
  );
  assert.equal(replacement.generation, 2);
  const spec = f.task('task:later');
  assert.throws(
    () =>
      f.store.delegateTask(
        f.chief,
        { task_id: spec.id, provider: 'codex', model: null },
        f.key(),
        f.version(),
      ),
    code('STALE_AUTHORITY'),
  );
});

test('delegation is a durable queued acknowledgment; claim consumes it atomically and preserves independent dependencies', (t) => {
  const f = fixture(t),
    a = f.task('task:a'),
    b = f.task('task:b', 'documenter', [a.id]);
  const args = { task_id: b.id, provider: 'codex' as const, model: null },
    k = f.key(),
    version = f.version();
  const queued = f.store.delegateTask(f.chief, args, k, version);
  assert.deepEqual(f.store.delegateTask(f.chief, args, k, version), queued);
  assert.equal(queued.status, 'queued');
  assert.equal(f.store.getTask(b.id).status, 'waiting_dependency');
  assert.equal(f.store.attempts(f.run.id).length, 0);
  assert.throws(
    () =>
      f.store.claimTask(f.user, b.id, f.session(b.id), f.key(), f.version()),
    code('TASK_NOT_READY'),
  );
  const qa = f.store.delegateTask(
    f.chief,
    { ...args, task_id: a.id },
    f.key(),
    f.version(),
  );
  const before = f.version();
  assert.throws(
    () =>
      f.store.claimTask(
        f.user,
        a.id,
        { ...f.session(a.id), provider: 'claude' },
        f.key(),
        f.version(),
      ),
    code('DELEGATION_MISMATCH'),
  );
  assert.equal(f.version(), before);
  const writer = f.claim(a);
  const claimed = f.store.getRecord<Delegation>(f.run.id, 'delegation', qa.id);
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.attempt_id, writer.attempt.id);
  assert.equal(
    f.store.getRecord<Delegation>(f.run.id, 'delegation', queued.id).status,
    'queued',
  );
});

test('blocking questions gate only listed tasks and user responses retain genuine provenance', (t) => {
  const f = fixture(t),
    a = f.task('task:a'),
    b = f.task('task:b');
  const q = f.store.requestQuestion(
    f.chief,
    {
      question_id: 'question:format',
      question: 'Which format?',
      options: [{ label: 'Markdown', consequence: 'Plain text document' }],
      affects_task_ids: [a.id],
      blocking: true,
    },
    f.key(),
    f.version(),
  );
  assert.throws(
    () =>
      f.store.claimTask(f.user, a.id, f.session(a.id), f.key(), f.version()),
    code('TASK_NOT_READY'),
  );
  const worker = f.claim(b);
  assert.throws(
    () =>
      f.store.respondQuestion(f.chief, q.id, 'Markdown', f.key(), f.version()),
    code('FORBIDDEN'),
  );
  const decision: Decision = {
    schema_version: 1,
    id: 'decision:format',
    run_id: f.run.id,
    question: q.question,
    answer: 'Markdown',
    status: 'approved',
    approved_by: f.user.id,
    source_ids: [],
    affects_task_ids: [a.id],
    supersedes: null,
    created_at: now(),
  };
  assert.throws(
    () =>
      f.store.recordDecision(f.chief, decision, f.key(), f.version(), {
        basis: 'user_response',
        user_response_id: 'response:forged',
      }),
    code('NOT_FOUND'),
  );
  const responseKey = f.key(),
    version = f.version();
  const response = f.store.respondQuestion(
    f.user,
    q.id,
    'Markdown',
    responseKey,
    version,
  );
  assert.deepEqual(
    f.store.respondQuestion(f.user, q.id, 'Markdown', responseKey, version),
    response,
  );
  assert.equal(response.user_actor_id, f.user.id);
  const sourced = { ...decision, source_ids: [response.source_id] };
  assert.throws(
    () =>
      f.store.recordDecision(
        f.chief,
        { ...sourced, id: 'decision:inverted', answer: 'Use PDF' },
        f.key(),
        f.version(),
        { basis: 'user_response', user_response_id: response.id },
      ),
    code('INVALID_PROVENANCE'),
  );
  f.store.recordDecision(f.chief, sourced, f.key(), f.version(), {
    basis: 'user_response',
    user_response_id: response.id,
  });
  assert.equal(
    f.store.getRecord<Decision>(f.run.id, 'decision', sourced.id).approved_by,
    f.user.id,
  );
  assert.throws(
    () =>
      f.store.recordDecision(
        f.chief,
        { ...sourced, id: 'decision:wrong-scope', affects_task_ids: [b.id] },
        f.key(),
        f.version(),
        { basis: 'user_response', user_response_id: response.id },
      ),
    code('INVALID_PROVENANCE'),
  );
  f.claim(a);
  assert.equal(f.store.getTask(b.id).active_attempt_id, worker.attempt.id);
});

test('worker notes and blockers require the current own assignment; waits enforce domain transitions', (t) => {
  const f = fixture(t),
    a = f.task('task:a'),
    b = f.task('task:b'),
    worker = f.claim(a);
  assert.throws(
    () =>
      f.store.setTaskWait(
        f.user,
        b.id,
        'waiting_provider',
        'queued provider',
        f.key(),
        f.version(),
      ),
    code('INVALID_TRANSITION'),
  );
  f.store.publishNote(
    worker.actor,
    {
      task_id: a.id,
      kind: 'progress',
      content: 'Snapshot in progress',
      source_ids: [],
    },
    f.key(),
    f.version(),
  );
  assert.throws(
    () =>
      f.store.publishNote(
        worker.actor,
        { task_id: b.id, kind: 'progress', content: 'forged', source_ids: [] },
        f.key(),
        f.version(),
      ),
    code('FORBIDDEN'),
  );
  const blocker = f.store.reportBlocker(
    worker.actor,
    {
      task_id: a.id,
      reason: 'Missing input',
      required_action: 'Supply input',
      source_ids: [],
    },
    f.key(),
    f.version(),
  );
  assert.equal(blocker.task_id, a.id);
  assert.equal(f.store.getTask(a.id).status, 'blocked');
  f.stop(worker.attempt.id);
  const delegated = f.store.delegateTask(
    f.chief,
    { task_id: a.id, provider: 'codex', model: null },
    f.key(),
    f.version(),
  );
  assert.equal(delegated.status, 'queued');
  f.store.reassignTask(f.user, a.id, f.key(), f.version());
  assert.throws(
    () =>
      f.store.publishNote(
        worker.actor,
        { task_id: a.id, kind: 'progress', content: 'late', source_ids: [] },
        f.key(),
        f.version(),
      ),
    code('STALE_ATTEMPT'),
  );
});

test('a cancelled run keeps late writer results and reassignment outside the domain state', (t) => {
  const f = fixture(t),
    spec = f.task('task:cancelled'),
    writer = f.claim(spec);
  f.store.updateRunStatus(f.user, 'cancelled', f.key(), f.version());
  const before = f.version();
  assert.throws(() => f.deliver(spec, writer), code('RUN_TERMINAL'));
  f.stop(writer.attempt.id);
  assert.throws(
    () => f.store.reassignTask(f.user, spec.id, f.key(), f.version()),
    code('RUN_TERMINAL'),
  );
  assert.equal(f.version(), before + 1);
  assert.equal(f.store.getTask(spec.id).status, 'running');
});

test('changes_requested is an accepted control result and permits targeted correction without accepting the producer', (t) => {
  const f = fixture(t),
    a = f.task('task:a'),
    writer = f.claim(a),
    handoff = f.deliver(a, writer);
  f.stop(writer.attempt.id);
  const control = f.review(handoff, [], {
    outcome: 'changes_requested',
    verification_scope: 'source',
    tested_revision: null,
    findings: [
      {
        severity: 'blocking',
        description: 'Missing one paragraph',
        reference: 'snapshot',
      },
    ],
  });
  assert.equal(f.store.getTask(control.review_task_id).status, 'accepted');
  assert.equal(f.store.getTask(a.id).status, 'changes_requested');
  f.store.delegateTask(
    f.chief,
    { task_id: a.id, provider: 'codex', model: null },
    f.key(),
    f.version(),
  );
  f.store.reassignTask(f.user, a.id, f.key(), f.version());
  const next = f.claim(a),
    corrected = f.deliver(a, next);
  assert.notEqual(corrected.attempt_id, handoff.attempt_id);
  assert.throws(
    () =>
      f.store.submitHandoff(
        writer.actor,
        { ...handoff, id: 'handoff:late' },
        f.key(),
        f.version(),
      ),
    code('STALE_ATTEMPT'),
  );
});

test('document delivery needs a stopped writer, independent review and a real hash without Git', (t) => {
  const f = fixture(t),
    a = f.task('task:a'),
    writer = f.claim(a),
    handoff = f.deliver(a, writer);
  const evidence = f.proof(writer.attempt.id, a.id, handoff.source_revision!),
    review = f.review(handoff, [evidence.value.id]);
  const args: AcceptDeliveryArgs = {
    handoff_id: handoff.id,
    review_ids: [review.id],
    verification_ids: [evidence.value.id],
    accepted_revision: handoff.source_revision!,
  };
  assert.throws(
    () => f.store.validateDelivery(f.chief, args),
    code('STALE_DELIVERY'),
  );
  f.stop(writer.attempt.id);
  assert.throws(
    () =>
      f.store.acceptDelivery(
        f.chief,
        { ...args, review_ids: [] } as unknown as AcceptDeliveryArgs,
        f.key(),
        f.version(),
      ),
    code('INVALID_INPUT'),
  );
  assert.throws(
    () =>
      f.store.acceptDelivery(
        f.chief,
        { ...args, verification_ids: [] } as unknown as AcceptDeliveryArgs,
        f.key(),
        f.version(),
      ),
    code('INVALID_INPUT'),
  );
  const before = f.version();
  f.store.validateDelivery(f.chief, args);
  assert.equal(f.version(), before);
  const dependent = f.task('task:dependent', 'documenter', [a.id]);
  const k = f.key(),
    version = f.version();
  assert.equal(
    f.store.acceptDelivery(f.chief, args, k, version).status,
    'accepted',
  );
  assert.deepEqual(
    f.store.acceptDelivery(f.chief, args, k, version).status,
    'accepted',
  );
  assert.equal(f.store.getTask(dependent.id).status, 'ready');
  assert.equal(f.project.git_common_dir, null);
});

test('only the service can persist the actual session working directory', (t) => {
  const f = fixture(t),
    spec = f.task('task:cwd'),
    writer = f.claim(spec);
  const session = f.store.getRecord<AgentSession>(
    f.run.id,
    'session',
    writer.attempt.session_id,
  );
  const actual = join(f.directory, 'real workspace');
  mkdirSync(actual);
  const changes = {
    native_session_id: 'native:actual',
    cli_version: 'fixture:1',
    capabilities: null,
    cwd: actual,
  };
  assert.throws(
    () =>
      f.store.updateSession(
        writer.actor,
        session.id,
        changes,
        f.key(),
        f.version(),
      ),
    code('FORBIDDEN'),
  );
  f.store.updateSession(f.user, session.id, changes, f.key(), f.version());
  assert.equal(
    f.store.getRecord<AgentSession>(f.run.id, 'session', session.id).cwd,
    actual,
  );
  assert.throws(
    () =>
      f.store.updateSession(
        f.user,
        session.id,
        { ...changes, cwd: join(actual, 'missing') },
        f.key(),
        f.version(),
      ),
    code('INVALID_SESSION'),
  );
});

test('a corrupted or missing artifact rolls back acceptance and cannot be final evidence', (t) => {
  const f = fixture(t),
    ready = f.ready(),
    before = f.version();
  const first = ready.handoff.artifacts[0]!;
  writeFileSync(join(f.project.data_dir, first.reference), 'corrupted');
  assert.throws(
    () => f.store.acceptDelivery(f.chief, ready.args, f.key(), f.version()),
    code('ARTIFACT_CHANGED'),
  );
  assert.equal(f.version(), before);
  assert.equal(f.store.getTask(ready.spec.id).status, 'in_review');
});

test('run completion validates criterion bindings atomically and records one replayable final result', (t) => {
  const f = fixture(t),
    ready = f.ready();
  f.store.acceptDelivery(f.chief, ready.args, f.key(), f.version());
  f.store.updateRunStatus(f.user, 'running', f.key(), f.version());
  const before = f.version(),
    eventCount = f.store.events(f.run.id, 0, 1000).length;
  assert.throws(
    () =>
      f.store.finishRun(
        f.chief,
        {
          summary: 'Premature',
          criterion_evidence: [
            {
              criterion_id: 'criterion:result',
              evidence_artifact_ids: [ready.handoff.artifacts[0]!.id],
            },
          ],
          delivered_artifact_ids: [ready.handoff.artifacts[0]!.id],
        },
        f.key(),
        f.version(),
      ),
    code('MISSING_EVIDENCE'),
  );
  assert.equal(f.version(), before);
  assert.equal(f.store.getRun(f.run.id).status, 'running');
  assert.equal(f.store.events(f.run.id, 0, 1000).length, eventCount);
  const args: FinishRunArgs = {
    summary: 'Verified document delivered',
    criterion_evidence: [
      {
        criterion_id: 'criterion:result',
        evidence_artifact_ids: [ready.evidence.log.id],
      },
    ],
    delivered_artifact_ids: [ready.handoff.artifacts[0]!.id],
  };
  const k = f.key(),
    version = f.version();
  assert.equal(
    f.store.finishRun(f.chief, args, k, version).status,
    'completed',
  );
  assert.equal(
    f.store.finishRun(f.chief, args, k, version).status,
    'completed',
  );
  assert.equal(f.version(), before + 1);
});

test('self-review and stale review cannot close either the producer or its control task', (t) => {
  const f = fixture(t),
    spec = f.task('task:producer', 'reviewer'),
    writer = f.claim(spec),
    handoff = f.deliver(spec, writer);
  const evidence = f.proof(
    writer.attempt.id,
    spec.id,
    handoff.source_revision!,
  );
  const review: Review = {
    schema_version: 1,
    id: 'review:self',
    run_id: f.run.id,
    review_task_id: spec.id,
    review_of_task_id: spec.id,
    handoff_id: handoff.id,
    outcome: 'approved',
    verification_scope: 'documentation',
    source_revision: handoff.source_revision!,
    tested_revision: handoff.source_revision,
    summary: 'Own review',
    findings: [],
    verification_ids: [evidence.value.id],
    created_at: now(),
  };
  const before = f.version();
  assert.throws(
    () => f.store.submitReview(writer.actor, review, f.key(), f.version()),
    code('SELF_REVIEW'),
  );
  assert.equal(f.version(), before);
  assert.equal(f.store.getTask(spec.id).status, 'in_review');
  const control = f.task('task:review', 'reviewer'),
    reviewer = f.claim(control);
  assert.throws(
    () =>
      f.store.submitReview(
        reviewer.actor,
        {
          ...review,
          id: 'review:stale',
          review_task_id: control.id,
          source_revision: `sha256:${'0'.repeat(64)}`,
        },
        f.key(),
        f.version(),
      ),
    code('STALE_REVIEW'),
  );
  assert.equal(f.store.getTask(control.id).status, 'running');
});

test('acceptance rejects failed, unrelated and wrong-revision proof records', (t) => {
  const f = fixture(t),
    ready = f.ready();
  const failed: Verification = {
    ...ready.evidence.value,
    id: 'verification:failed',
    result: 'failed',
    exit_code: 1,
    execution: 'automated',
    command: ['test'],
  };
  f.store.saveVerification(f.user, ready.spec.id, failed, f.key(), f.version());
  assert.throws(
    () =>
      f.store.acceptDelivery(
        f.chief,
        { ...ready.args, verification_ids: [failed.id] },
        f.key(),
        f.version(),
      ),
    code('INVALID_EVIDENCE'),
  );
  const wrong: Verification = {
    ...ready.evidence.value,
    id: 'verification:wrong-revision',
    tested_revision: `sha256:${'0'.repeat(64)}`,
  };
  f.store.saveVerification(f.user, ready.spec.id, wrong, f.key(), f.version());
  assert.throws(
    () =>
      f.store.acceptDelivery(
        f.chief,
        { ...ready.args, verification_ids: [wrong.id] },
        f.key(),
        f.version(),
      ),
    code('INVALID_EVIDENCE'),
  );
  const other = f.task('task:other'),
    worker = f.claim(other),
    unrelated = f.proof(
      worker.attempt.id,
      other.id,
      ready.args.accepted_revision,
    );
  assert.throws(
    () =>
      f.store.acceptDelivery(
        f.chief,
        {
          ...ready.args,
          verification_ids: [ready.evidence.value.id, unrelated.value.id],
        },
        f.key(),
        f.version(),
      ),
    code('INVALID_EVIDENCE'),
  );
  assert.equal(f.store.getTask(ready.spec.id).status, 'in_review');
});

test('partial or limited delivery and a source-only review cannot pass delivery acceptance', (t) => {
  const f = fixture(t),
    spec = f.task('task:limited'),
    writer = f.claim(spec);
  const handoff = f.deliver(spec, writer, {
    limitations: ['Required check remains unexecuted'],
  });
  f.stop(writer.attempt.id);
  const evidence = f.proof(
      writer.attempt.id,
      spec.id,
      handoff.source_revision!,
    ),
    review = f.review(handoff, [evidence.value.id], {
      verification_scope: 'source',
    });
  const args: AcceptDeliveryArgs = {
    handoff_id: handoff.id,
    review_ids: [review.id],
    verification_ids: [evidence.value.id],
    accepted_revision: handoff.source_revision!,
  };
  assert.throws(
    () => f.store.acceptDelivery(f.chief, args, f.key(), f.version()),
    code('INCOMPLETE_DELIVERY'),
  );
  const g = fixture(t),
    ready = g.ready();
  const sourceReview = g.review(ready.handoff, [ready.evidence.value.id], {
    verification_scope: 'source',
  });
  assert.throws(
    () =>
      g.store.acceptDelivery(
        g.chief,
        { ...ready.args, review_ids: [sourceReview.id] },
        g.key(),
        g.version(),
      ),
    code('INVALID_REVIEW'),
  );
});

test('required claims and review evidence remain mandatory even with a successful writer exit', (t) => {
  const f = fixture(t),
    spec = f.task('task:unclaimed'),
    writer = f.claim(spec);
  const handoff = f.deliver(spec, writer, { criteria_claimed: [] });
  f.stop(writer.attempt.id);
  const evidence = f.proof(
    writer.attempt.id,
    spec.id,
    handoff.source_revision!,
  );
  const review = f.review(handoff, [evidence.value.id]);
  const args: AcceptDeliveryArgs = {
    handoff_id: handoff.id,
    review_ids: [review.id],
    verification_ids: [evidence.value.id],
    accepted_revision: handoff.source_revision!,
  };
  assert.throws(
    () => f.store.acceptDelivery(f.chief, args, f.key(), f.version()),
    code('MISSING_CRITERIA'),
  );
  assert.equal(f.store.getTask(spec.id).status, 'in_review');
});

test('questions, decisions and evidence retain run isolation', (t) => {
  const f = fixture(t),
    spec = f.task('task:local');
  const run = { ...f.run, id: 'run:foreign' };
  f.store.createRun(run, 'run:foreign-create');
  const foreign: Actor = { ...f.user, run_id: run.id };
  assert.throws(
    () =>
      f.store.requestQuestion(
        foreign,
        {
          question_id: 'question:foreign',
          question: 'Foreign?',
          options: [],
          affects_task_ids: [spec.id],
          blocking: true,
        },
        f.key(),
        f.store.getRun(run.id).version,
      ),
    code('INVALID_QUESTION'),
  );
  assert.throws(
    () =>
      f.store.observation(foreign, 'provider.output', {}, { task_id: spec.id }),
    code('WRONG_RUN'),
  );
  const q = f.store.requestQuestion(
    f.user,
    {
      question_id: 'question:local',
      question: 'Local?',
      options: [],
      affects_task_ids: [spec.id],
      blocking: false,
    },
    f.key(),
    f.version(),
  );
  assert.throws(
    () =>
      f.store.respondQuestion(
        foreign,
        q.id,
        'Forged',
        f.key(),
        f.store.getRun(run.id).version,
      ),
    code('NOT_FOUND'),
  );
  assert.equal(f.store.getRun(run.id).version, run.version);
});

test('a final response refuses open blocking questions and unobserved attempts with no partial status change', (t) => {
  const f = fixture(t),
    ready = f.ready();
  f.store.acceptDelivery(f.chief, ready.args, f.key(), f.version());
  f.store.updateRunStatus(f.user, 'running', f.key(), f.version());
  const pending = f.task('task:pending'),
    worker = f.claim(pending);
  const args: FinishRunArgs = {
    summary: 'Too early',
    criterion_evidence: [
      {
        criterion_id: 'criterion:result',
        evidence_artifact_ids: [ready.evidence.log.id],
      },
    ],
    delivered_artifact_ids: [ready.handoff.artifacts[0]!.id],
  };
  assert.throws(
    () => f.store.finishRun(f.chief, args, f.key(), f.version()),
    code('RUN_BUSY'),
  );
  f.stop(worker.attempt.id);
  f.store.requestQuestion(
    f.chief,
    {
      question_id: 'question:pending',
      question: 'Need input?',
      options: [],
      affects_task_ids: [pending.id],
      blocking: true,
    },
    f.key(),
    f.version(),
  );
  assert.throws(
    () => f.store.finishRun(f.chief, args, f.key(), f.version()),
    code('RUN_BUSY'),
  );
  assert.equal(f.store.getRun(f.run.id).status, 'running');
});

test('code delivery accepts only the exact validated and promoted Git candidate with observed checks', async (t) => {
  const f = fixture(t, 'code'),
    spec = f.task('task:code', 'developer'),
    writer = f.claim(spec);
  const manager = new WorkspaceManager(f.store, f.user);
  const workspace = await manager.createWorkspace(
    {
      taskId: spec.id,
      attemptId: writer.attempt.id,
      baseRevision: spec.base_revision!,
      mode: 'code',
    },
    'workspace:create',
  );
  writeFileSync(join(workspace.path, 'result.txt'), 'verified result');
  const delivery = await manager.collectDelivery(
    workspace.operationId,
    { writePaths: ['**'] },
    'workspace:collect',
  );
  assert.ok(delivery.preservationRef);
  const source: ArtifactRef = {
    id: 'artifact:git-source',
    kind: 'git_commit',
    reference: delivery.preservationRef,
    revision: delivery.sourceRevision,
    producer_attempt_id: writer.attempt.id,
    created_at: now(),
  };
  const handoff = f.deliver(spec, writer, {
    source_revision: delivery.sourceRevision,
    artifacts: [source],
  });
  f.stop(writer.attempt.id);
  const command: [string, ...string[]] = [
    process.execPath,
    '-e',
    "require('node:assert/strict').equal(require('node:fs').readFileSync('result.txt','utf8'),'verified result')",
  ];
  const candidate = await manager.prepareIntegration(
    {
      targetRef: 'refs/heads/crew-result',
      expectedBase: spec.base_revision!,
      deliveryOperationIds: [delivery.operationId],
      checks: [{ id: 'check:combined', command }],
    },
    'integration:prepare',
  );
  assert.equal(candidate.status, 'validated');
  const observed = candidate.proofs[0]!;
  const log = f.artifact(
    writer.attempt.id,
    'artifact:combined-log',
    JSON.stringify(observed),
    'test_log',
  );
  const proof: Verification = {
    id: 'verification:combined',
    criterion_ids: ['criterion:result'],
    mode: 'static',
    execution: 'automated',
    command,
    cwd: observed.cwd,
    result: 'passed',
    exit_code: 0,
    tested_revision: candidate.candidateRevision,
    evidence_artifact_ids: [log.id],
    started_at: now(),
    ended_at: now(),
    provider: null,
  };
  f.store.saveVerification(f.user, spec.id, proof, f.key(), f.version(), [log]);
  const review = f.review(handoff, [proof.id], {
    verification_scope: 'combined_code',
    tested_revision: candidate.candidateRevision,
  });
  const args: AcceptDeliveryArgs = {
    handoff_id: handoff.id,
    review_ids: [review.id],
    verification_ids: [proof.id],
    accepted_revision: candidate.candidateRevision,
  };
  const before = f.version();
  f.store.validateDelivery(f.chief, args);
  assert.equal(f.version(), before);
  assert.throws(
    () => f.store.acceptDelivery(f.chief, args, f.key(), f.version()),
    code('INTEGRATION_REQUIRED'),
  );
  assert.equal(f.store.getTask(spec.id).status, 'in_review');
  await manager.promoteIntegration(
    candidate.operationId,
    'integration:promote',
  );
  const accepted = f.store.acceptDelivery(f.chief, args, f.key(), f.version());
  assert.equal(accepted.accepted_revision, candidate.candidateRevision);
  assert.equal(
    git(f.root, 'rev-parse', 'refs/heads/crew-result'),
    candidate.candidateRevision.slice(4),
  );
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), spec.base_revision!.slice(4));
});
