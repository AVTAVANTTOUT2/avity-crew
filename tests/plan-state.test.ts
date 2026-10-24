import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, identifyProject } from '../packages/storage/src/index.ts';
import type {
  ControlResult,
  TaskRevision,
} from '../packages/storage/src/index.ts';
import { CrewError, now } from '../packages/contracts/src/index.ts';
import type {
  Actor,
  AgentSession,
  ArtifactRef,
  Criterion,
  Decision,
  FinishRunArgs,
  Handoff,
  Review,
  Run,
  TaskSpec,
  Verification,
  ProjectConfig,
} from '../packages/contracts/src/index.ts';

const code = (expected: string) => (error: unknown) =>
  error instanceof CrewError && error.code === expected;

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'crew plan state ')),
    root = join(directory, 'project');
  mkdirSync(root);
  const project = identifyProject(root, join(directory, 'data'));
  const store = new Store(project);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const criteria: [Criterion, Criterion] = [
    {
      id: 'criterion:document',
      description: 'Produce the requested document',
      required: true,
      verification: 'Document inspection',
    },
    {
      id: 'criterion:review',
      description:
        'Independently review and accept the exact delivery before closure',
      required: true,
      verification: 'Review result linked to accepted delivery',
    },
  ];
  const run: Run = {
    id: 'run:plan',
    project_id: project.id,
    objective:
      'Produce a document and independently review its accepted delivery',
    constraints: ['Preserve both original run criteria'],
    acceptance_criteria: criteria,
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
  store.createRun(run, 'run:create');
  const user: Actor = {
    id: 'user:local',
    role: 'user',
    project_id: project.id,
    run_id: run.id,
    task_id: null,
    attempt_id: null,
    generation: 1,
  };
  const chief: Actor = { ...user, id: 'chief:plan', role: 'chief' };
  let sequence = 0;
  const key = () => `request:${++sequence}`,
    version = () => store.getRun(run.id).version;
  store.updateRunStatus(user, 'running', key(), version());
  const task = (
    id: string,
    role: TaskSpec['role'],
    acceptance: [Criterion, ...Criterion[]],
    depends: string[] = [],
  ): TaskSpec => {
    const spec: TaskSpec = {
      schema_version: 1,
      id,
      run_id: run.id,
      title: id,
      objective:
        role === 'reviewer'
          ? 'Inspect the immutable delivery and report its actual outcome'
          : 'Write the requested document',
      role,
      acceptance_criteria: acceptance,
      depends_on: depends,
      scope: {
        read_paths: ['docs/'],
        write_paths: role === 'reviewer' ? [] : ['docs/'],
        excluded_paths: [],
      },
      base_revision: null,
      context_source_ids: [],
      expected_deliverables: ['Immutable result'],
      created_at: now(),
    };
    store.createTask(chief, spec, key(), version());
    return spec;
  };
  const claim = (spec: TaskSpec) => {
    const session: AgentSession = {
      id: `session:${++sequence}`,
      run_id: run.id,
      task_id: spec.id,
      provider: 'fake',
      model: null,
      native_session_id: `simulated:conversation-${sequence}`,
      cli_version: 'fixture',
      cwd: root,
      capabilities: null,
    };
    const attempt = store.claimTask(chief, spec.id, session, key(), version());
    store.observeAttempt(
      user,
      attempt.id,
      { status: 'running', pid: null, exit_code: null },
      key(),
      version(),
    );
    const actor: Actor = {
      ...user,
      id: session.id,
      role: spec.role,
      task_id: spec.id,
      attempt_id: attempt.id,
      generation: attempt.generation,
    };
    return { attempt, actor, session };
  };
  const stop = (attemptId: string) =>
    store.observeAttempt(
      user,
      attemptId,
      { status: 'exited', pid: null, exit_code: 0 },
      key(),
      version(),
    );
  const decision = (taskId: string, overrides: Partial<Decision> = {}) => {
    const value: Decision = {
      schema_version: 1,
      id: `decision:${++sequence}`,
      run_id: run.id,
      question: 'How to correct the plan?',
      answer:
        'Assign document production to the writer and review evidence to the independent reviewer',
      status: 'approved',
      approved_by: chief.id,
      source_ids: [],
      affects_task_ids: [taskId],
      supersedes: null,
      created_at: now(),
      ...overrides,
    };
    store.recordDecision(chief, value, key(), version());
    return value;
  };
  const deliver = (
    spec: TaskSpec,
    worker: ReturnType<typeof claim>,
    claims = spec.acceptance_criteria.map((item) => item.id),
    content = '# Actual document\n',
  ) => {
    const artifact: ArtifactRef = {
      id: `artifact:${++sequence}`,
      kind: 'file',
      ...store.writeArtifact(content),
      producer_attempt_id: worker.attempt.id,
      created_at: now(),
    };
    const handoff: Handoff = {
      schema_version: 1,
      id: `handoff:${++sequence}`,
      run_id: run.id,
      task_id: spec.id,
      attempt_id: worker.attempt.id,
      generation: worker.attempt.generation,
      status: 'delivered',
      summary: 'Actual immutable document snapshot',
      source_revision: artifact.revision,
      artifacts: [artifact],
      verifications: [],
      criteria_claimed: claims,
      limitations: [],
      next_information: [],
      created_at: now(),
    };
    store.submitHandoff(worker.actor, handoff, key(), version());
    return handoff;
  };
  const proof = (
    spec: TaskSpec,
    worker: ReturnType<typeof claim>,
    handoff: Handoff,
  ) => {
    const artifact: ArtifactRef = {
      id: `artifact:observation-${++sequence}`,
      kind: 'test_log',
      ...store.writeArtifact('Observed the exact document snapshot'),
      producer_attempt_id: worker.attempt.id,
      created_at: now(),
    };
    const value: Verification = {
      id: `verification:${++sequence}`,
      criterion_ids: spec.acceptance_criteria.map((item) => item.id) as [
        string,
        ...string[],
      ],
      mode: 'static',
      execution: 'manual',
      command: null,
      cwd: root,
      result: 'passed',
      exit_code: null,
      tested_revision: handoff.source_revision!,
      evidence_artifact_ids: [artifact.id],
      started_at: now(),
      ended_at: now(),
      provider: null,
    };
    store.saveVerification(user, spec.id, value, key(), version(), [artifact]);
    return { value, artifact };
  };
  const review = (
    spec: TaskSpec,
    reviewer: ReturnType<typeof claim>,
    handoff: Handoff,
    proofs: string[],
    negative = false,
  ) => {
    const value: Review = {
      schema_version: 1,
      id: `review:${++sequence}`,
      run_id: run.id,
      review_task_id: spec.id,
      review_of_task_id: handoff.task_id,
      handoff_id: handoff.id,
      outcome: negative ? 'changes_requested' : 'approved',
      verification_scope: negative ? 'source' : 'documentation',
      source_revision: handoff.source_revision!,
      tested_revision: negative ? null : handoff.source_revision,
      summary: negative
        ? 'A targeted correction is required'
        : 'The exact immutable document and recorded observations satisfy this inspection',
      findings: negative
        ? [
            {
              severity: 'blocking',
              description: 'Missing required detail',
              reference: 'document',
            },
          ]
        : [],
      verification_ids: proofs,
      created_at: now(),
    };
    store.submitReview(reviewer.actor, value, key(), version());
    return value;
  };
  const accepted = (
    writerCriteria: [Criterion, ...Criterion[]] = [criteria[0]],
    reviewerCriteria: [Criterion, ...Criterion[]] = [criteria[1]],
  ) => {
    const spec = task('task:writer', 'documenter', writerCriteria),
      worker = claim(spec),
      handoff = deliver(spec, worker);
    stop(worker.attempt.id);
    const evidence = proof(spec, worker, handoff);
    const control = task('task:reviewer', 'reviewer', reviewerCriteria),
      reviewer = claim(control);
    const reviewed = review(control, reviewer, handoff, [evidence.value.id]);
    stop(reviewer.attempt.id);
    store.acceptDelivery(
      chief,
      {
        handoff_id: handoff.id,
        review_ids: [reviewed.id],
        verification_ids: [evidence.value.id],
        accepted_revision: handoff.source_revision!,
      },
      key(),
      version(),
    );
    return { spec, worker, handoff, evidence, control, reviewer, reviewed };
  };
  return {
    directory,
    root,
    project,
    store,
    run,
    criteria,
    user,
    chief,
    key,
    version,
    task,
    claim,
    stop,
    decision,
    deliver,
    proof,
    review,
    accepted,
  };
}

test('review control criteria have a real immutable result linked to an accepted writer delivery and can complete the unchanged run', (t) => {
  const f = fixture(t),
    accepted = f.accepted();
  assert.throws(
    () =>
      f.store.finishRun(
        f.chief,
        {
          summary: 'Missing global review criterion',
          criterion_evidence: [
            {
              criterion_id: f.criteria[0].id,
              evidence_artifact_ids: [accepted.evidence.artifact.id],
            },
          ],
          delivered_artifact_ids: [accepted.handoff.artifacts[0]!.id],
        },
        f.key(),
        f.version(),
      ),
    code('MISSING_EVIDENCE'),
  );
  const artifact = f.store
    .records<ArtifactRef>(f.run.id, 'artifact')
    .find((item) => item.producer_attempt_id === accepted.reviewer.attempt.id);
  assert.ok(
    artifact,
    'An accepted review control needs an actual canonical snapshot',
  );
  assert.deepEqual(
    JSON.parse(f.store.readArtifact(artifact).toString('utf8')),
    accepted.reviewed,
  );
  const controlProof = f.store
    .records<Verification>(f.run.id, 'verification')
    .find((item) => item.evidence_artifact_ids.includes(artifact.id));
  assert.ok(controlProof);
  assert.deepEqual(controlProof.criterion_ids, [f.criteria[1].id]);
  assert.equal(controlProof.mode, 'static');
  assert.equal(controlProof.execution, 'manual');
  assert.equal(controlProof.command, null);
  assert.equal(controlProof.exit_code, null);
  assert.equal(controlProof.provider, 'fake');
  const args: FinishRunArgs = {
    summary:
      'Writer and independent control satisfy both unchanged run criteria',
    criterion_evidence: [
      {
        criterion_id: f.criteria[0].id,
        evidence_artifact_ids: [accepted.evidence.artifact.id],
      },
      { criterion_id: f.criteria[1].id, evidence_artifact_ids: [artifact.id] },
    ],
    delivered_artifact_ids: [accepted.handoff.artifacts[0]!.id, artifact.id],
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
  assert.deepEqual(
    f.store.getRun(f.run.id).acceptance_criteria,
    f.run.acceptance_criteria,
  );
  assert.equal(f.store.getRun(f.run.id).objective, f.run.objective);
  assert.equal(f.store.tasks(f.run.id).length, 2);
  assert.equal(f.store.records(f.run.id, 'handoff').length, 1);
});

test('a decided plan amendment fences the old handoff and preserves both global criteria through a new writer submission', (t) => {
  const f = fixture(t),
    spec = f.task('task:writer', 'documenter', f.criteria),
    writer = f.claim(spec);
  const old = f.deliver(spec, writer, [f.criteria[0].id]);
  f.stop(writer.attempt.id);
  const approval = f.decision(spec.id);
  const next = {
    ...spec,
    acceptance_criteria: [f.criteria[0]] as [Criterion, ...Criterion[]],
    scope: { ...spec.scope, write_paths: ['docs/livrable.md'] },
  };
  const args = {
    task: next,
    reason:
      'The writer produces the document; an independent control proves the review criterion',
    decision_id: approval.id,
  };
  const k = f.key(),
    version = f.version();
  const amended = f.store.amendTask(f.chief, args, k, version);
  assert.equal(amended.status, 'changes_requested');
  assert.equal(amended.generation, writer.attempt.generation + 1);
  assert.deepEqual(f.store.amendTask(f.chief, args, k, version), amended);
  const revisions = f.store.records<TaskRevision>(f.run.id, 'task_revision');
  assert.equal(revisions.length, 1);
  assert.deepEqual(revisions[0]!.previous_spec, spec);
  assert.deepEqual(revisions[0]!.next_spec, amended.spec);
  assert.equal(revisions[0]!.actor.id, f.chief.id);
  assert.equal(revisions[0]!.decision_id, approval.id);
  assert.throws(
    () =>
      f.store.submitHandoff(
        writer.actor,
        { ...old, id: 'handoff:late' },
        f.key(),
        f.version(),
      ),
    code('STALE_ATTEMPT'),
  );
  assert.throws(
    () =>
      f.store.acceptDelivery(
        f.chief,
        {
          handoff_id: old.id,
          review_ids: ['review:old'],
          verification_ids: ['verification:old'],
          accepted_revision: old.source_revision!,
        },
        f.key(),
        f.version(),
      ),
    code('STALE_DELIVERY'),
  );
  f.store.reassignTask(f.user, spec.id, f.key(), f.version());
  const replacement = f.claim(amended.spec),
    handoff = f.deliver(amended.spec, replacement);
  f.stop(replacement.attempt.id);
  const evidence = f.proof(amended.spec, replacement, handoff);
  const control = f.task('task:review', 'reviewer', [f.criteria[1]]),
    reviewer = f.claim(control);
  const review = f.review(control, reviewer, handoff, [evidence.value.id]);
  f.stop(reviewer.attempt.id);
  f.store.acceptDelivery(
    f.chief,
    {
      handoff_id: handoff.id,
      review_ids: [review.id],
      verification_ids: [evidence.value.id],
      accepted_revision: handoff.source_revision!,
    },
    f.key(),
    f.version(),
  );
  const result = f.store.records<ControlResult>(f.run.id, 'control_result')[0]!;
  const final = f.store.finishRun(
    f.chief,
    {
      summary: 'Corrected assignment preserves the original run obligations',
      criterion_evidence: [
        {
          criterion_id: f.criteria[0].id,
          evidence_artifact_ids: [evidence.artifact.id],
        },
        {
          criterion_id: f.criteria[1].id,
          evidence_artifact_ids: [result.artifact_id],
        },
      ],
      delivered_artifact_ids: [handoff.artifacts[0]!.id],
    },
    f.key(),
    f.version(),
  );
  assert.equal(final.status, 'completed');
  assert.deepEqual(final.acceptance_criteria, f.run.acceptance_criteria);
  assert.deepEqual(final.constraints, f.run.constraints);
  assert.equal(final.objective, f.run.objective);
});

test('amendment requires chief authority, an approved scoped decision, stopped attempts and valid immutable DAG scope', (t) => {
  const f = fixture(t),
    spec = f.task('task:writer', 'documenter', f.criteria),
    writer = f.claim(spec),
    decision = f.decision(spec.id);
  const args = {
    task: { ...spec, objective: 'Refined writer mission' },
    reason: 'Clarify assignment',
    decision_id: decision.id,
  };
  assert.throws(
    () => f.store.amendTask(writer.actor, args, f.key(), f.version()),
    code('FORBIDDEN'),
  );
  assert.throws(
    () => f.store.amendTask(f.chief, args, f.key(), f.version()),
    code('RECONCILIATION_REQUIRED'),
  );
  f.stop(writer.attempt.id);
  const proposed = f.decision(spec.id, {
    status: 'proposed',
    approved_by: null,
  });
  assert.throws(
    () =>
      f.store.amendTask(
        f.chief,
        { ...args, decision_id: proposed.id },
        f.key(),
        f.version(),
      ),
    code('DECISION_REQUIRED'),
  );
  const other = f.task('task:other', 'documenter', [f.criteria[0]]),
    unrelated = f.decision(other.id);
  assert.throws(
    () =>
      f.store.amendTask(
        f.chief,
        { ...args, decision_id: unrelated.id },
        f.key(),
        f.version(),
      ),
    code('DECISION_REQUIRED'),
  );
  assert.throws(
    () =>
      f.store.amendTask(
        f.chief,
        { ...args, task: { ...args.task, created_at: '2026-01-01T00:00:00Z' } },
        f.key(),
        f.version(),
      ),
    code('IMMUTABLE_TASK'),
  );
  assert.throws(
    () =>
      f.store.amendTask(
        f.chief,
        { ...args, task: { ...args.task, run_id: 'run:foreign' } },
        f.key(),
        f.version(),
      ),
    code('WRONG_RUN'),
  );
  assert.throws(
    () =>
      f.store.amendTask(
        f.chief,
        {
          ...args,
          task: {
            ...args.task,
            scope: { ...args.task.scope, write_paths: ['docs/../private'] },
          },
        },
        f.key(),
        f.version(),
      ),
    code('INVALID_SCOPE'),
  );
  const dependent = f.task(
    'task:dependent',
    'documenter',
    [f.criteria[0]],
    [spec.id],
  );
  assert.throws(
    () =>
      f.store.amendTask(
        f.chief,
        { ...args, task: { ...args.task, depends_on: [dependent.id] } },
        f.key(),
        f.version(),
      ),
    code('DEPENDENCY_CYCLE'),
  );
  assert.throws(
    () =>
      f.store.amendTask(
        f.chief,
        { ...args, task: { ...args.task, depends_on: ['task:absent'] } },
        f.key(),
        f.version(),
      ),
    code('MISSING_DEPENDENCY'),
  );
  const op = f.store.beginOperation(
    f.user,
    'provider.turn',
    JSON.stringify({ actor: writer.actor }),
    f.key(),
    f.version(),
  );
  assert.throws(
    () => f.store.amendTask(f.chief, args, f.key(), f.version()),
    code('RECONCILIATION_REQUIRED'),
  );
  f.store.observeOperation(
    f.user,
    op.id,
    'completed',
    { business_success: false },
    f.key(),
    f.version(),
  );
  assert.equal(f.store.records(f.run.id, 'task_revision').length, 0);
  assert.deepEqual(f.store.getTask(spec.id).spec, spec);
});

test('ready amendments support an explicit global decision, preserve questions, and reject terminal tasks', (t) => {
  const f = fixture(t),
    ready = f.task('task:ready', 'documenter', [f.criteria[0]]),
    global = f.decision(ready.id, { affects_task_ids: [] });
  const question = f.store.requestQuestion(
    f.chief,
    {
      question_id: 'question:open',
      question: 'Which document format?',
      options: [],
      affects_task_ids: [ready.id],
      blocking: true,
    },
    f.key(),
    f.version(),
  );
  const updated = f.store.amendTask(
    f.chief,
    {
      task: { ...ready, objective: 'Clarified output' },
      reason: 'Apply the approved global plan decision',
      decision_id: global.id,
    },
    f.key(),
    f.version(),
  );
  assert.equal(updated.status, 'ready');
  assert.equal(updated.wait_reason, `question:${question.id}`);
  assert.throws(() => f.claim(updated.spec), code('TASK_NOT_READY'));
  f.store.respondQuestion(
    f.user,
    question.id,
    'Markdown',
    f.key(),
    f.version(),
  );
  const worker = f.claim(updated.spec);
  f.store.reportBlocker(
    worker.actor,
    {
      task_id: updated.id,
      reason: 'Prior hash unavailable',
      required_action: 'Use the new capture API',
      source_ids: [],
    },
    f.key(),
    f.version(),
  );
  f.stop(worker.attempt.id);
  f.store.reassignTask(f.user, updated.id, f.key(), f.version());
  assert.equal(f.store.getTask(updated.id).wait_reason, null);
  const resumed = f.claim(updated.spec);
  assert.equal(f.store.getTask(updated.id).wait_reason, null);
  const delivered = f.deliver(updated.spec, resumed);
  assert.ok(delivered.id);
  assert.equal(f.store.getTask(updated.id).wait_reason, null);
  const g = fixture(t),
    accepted = g.accepted(),
    approval = g.decision(accepted.spec.id);
  assert.throws(
    () =>
      g.store.amendTask(
        g.chief,
        {
          task: accepted.spec,
          reason: 'Cannot rewrite an accepted task',
          decision_id: approval.id,
        },
        g.key(),
        g.version(),
      ),
    code('INVALID_TRANSITION'),
  );
});

for (const negative of [true, false]) {
  test(`a ${negative ? 'changes_requested' : 'previous approved'} control cannot cover a later delivery that did not accept that review`, (t) => {
    const f = fixture(t),
      spec = f.task('task:writer', 'documenter', [f.criteria[0]]),
      worker = f.claim(spec),
      old = f.deliver(spec, worker);
    f.stop(worker.attempt.id);
    const first = f.proof(spec, worker, old);
    const oldControl = f.task('task:old-review', 'reviewer', [f.criteria[1]]),
      oldReviewer = f.claim(oldControl);
    f.review(
      oldControl,
      oldReviewer,
      old,
      negative ? [] : [first.value.id],
      negative,
    );
    f.stop(oldReviewer.attempt.id);
    const oldResult = f.store.records<ControlResult>(
      f.run.id,
      'control_result',
    )[0]!;
    const decision = f.decision(spec.id);
    f.store.amendTask(
      f.chief,
      {
        task: { ...spec, objective: 'Produce the corrected document' },
        reason: 'A new delivery is required',
        decision_id: decision.id,
      },
      f.key(),
      f.version(),
    );
    f.store.reassignTask(f.user, spec.id, f.key(), f.version());
    const current = f.claim(spec),
      handoff = f.deliver(
        spec,
        current,
        [f.criteria[0].id],
        '# Corrected document\n',
      );
    f.stop(current.attempt.id);
    const evidence = f.proof(spec, current, handoff),
      control = f.task('task:new-review', 'reviewer', [f.criteria[0]]),
      reviewer = f.claim(control);
    const review = f.review(control, reviewer, handoff, [evidence.value.id]);
    f.stop(reviewer.attempt.id);
    f.store.acceptDelivery(
      f.chief,
      {
        handoff_id: handoff.id,
        review_ids: [review.id],
        verification_ids: [evidence.value.id],
        accepted_revision: handoff.source_revision!,
      },
      f.key(),
      f.version(),
    );
    assert.throws(
      () =>
        f.store.finishRun(
          f.chief,
          {
            summary: 'An obsolete review is not final evidence',
            criterion_evidence: [
              {
                criterion_id: f.criteria[0].id,
                evidence_artifact_ids: [evidence.artifact.id],
              },
              {
                criterion_id: f.criteria[1].id,
                evidence_artifact_ids: [oldResult.artifact_id],
              },
            ],
            delivered_artifact_ids: [handoff.artifacts[0]!.id],
          },
          f.key(),
          f.version(),
        ),
      code('MISSING_EVIDENCE'),
    );
    assert.equal(f.store.getRun(f.run.id).status, 'running');
    assert.equal(f.store.records(f.run.id, 'final').length, 0);
  });
}

test('a corrupted canonical control snapshot cannot complete the run', (t) => {
  const f = fixture(t),
    accepted = f.accepted(),
    control = f.store.records<ControlResult>(f.run.id, 'control_result')[0]!;
  const artifact = f.store.getRecord<ArtifactRef>(
    f.run.id,
    'artifact',
    control.artifact_id,
  );
  writeFileSync(
    join(f.store.project.data_dir, artifact.reference),
    'Corrupted review snapshot',
  );
  assert.throws(
    () =>
      f.store.finishRun(
        f.chief,
        {
          summary: 'No altered proof can close the run',
          criterion_evidence: [
            {
              criterion_id: f.criteria[0].id,
              evidence_artifact_ids: [accepted.evidence.artifact.id],
            },
            {
              criterion_id: f.criteria[1].id,
              evidence_artifact_ids: [artifact.id],
            },
          ],
          delivered_artifact_ids: [accepted.handoff.artifacts[0]!.id],
        },
        f.key(),
        f.version(),
      ),
    code('ARTIFACT_CHANGED'),
  );
  assert.equal(f.store.getRun(f.run.id).status, 'running');
});

test('amendment and its revision roll back with the event and replay once after recovery', (t) => {
  const f = fixture(t),
    spec = f.task('task:ready', 'documenter', f.criteria),
    decision = f.decision(spec.id);
  const args = {
    task: {
      ...spec,
      acceptance_criteria: [f.criteria[0]] as [Criterion, ...Criterion[]],
    },
    reason: 'Move the control criterion to a reviewer',
    decision_id: decision.id,
  };
  const db = new DatabaseSync(f.store.filename);
  try {
    db.exec(
      "CREATE TRIGGER fail_amend BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.type')='task.amended' BEGIN SELECT RAISE(ABORT,'forced append failure'); END",
    );
    const k = f.key(),
      version = f.version(),
      before = f.store.getTask(spec.id);
    assert.throws(
      () => f.store.amendTask(f.chief, args, k, version),
      /forced append failure/,
    );
    assert.deepEqual(f.store.getTask(spec.id), before);
    assert.equal(f.version(), version);
    assert.equal(f.store.records(f.run.id, 'task_revision').length, 0);
    db.exec('DROP TRIGGER fail_amend');
    const updated = f.store.amendTask(f.chief, args, k, version);
    assert.deepEqual(f.store.amendTask(f.chief, args, k, version), updated);
    assert.equal(f.store.records(f.run.id, 'task_revision').length, 1);
  } finally {
    db.close();
  }
});

test('review result, proof and control transition are atomic and idempotent with their event', (t) => {
  const f = fixture(t),
    spec = f.task('task:writer', 'documenter', [f.criteria[0]]),
    writer = f.claim(spec),
    handoff = f.deliver(spec, writer);
  f.stop(writer.attempt.id);
  const evidence = f.proof(spec, writer, handoff),
    control = f.task('task:review', 'reviewer', [f.criteria[1]]),
    reviewer = f.claim(control);
  const review: Review = {
    schema_version: 1,
    id: 'review:atomic',
    run_id: f.run.id,
    review_task_id: control.id,
    review_of_task_id: spec.id,
    handoff_id: handoff.id,
    outcome: 'approved',
    verification_scope: 'documentation',
    source_revision: handoff.source_revision!,
    tested_revision: handoff.source_revision,
    summary: 'Actual exact review result',
    findings: [],
    verification_ids: [evidence.value.id],
    created_at: now(),
  };
  const db = new DatabaseSync(f.store.filename);
  try {
    db.exec(
      "CREATE TRIGGER fail_review BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.type')='review.submitted' BEGIN SELECT RAISE(ABORT,'forced append failure'); END",
    );
    const k = f.key(),
      version = f.version(),
      artifacts = f.store.records(f.run.id, 'artifact').length;
    assert.throws(
      () => f.store.submitReview(reviewer.actor, review, k, version),
      /forced append failure/,
    );
    assert.equal(f.store.getTask(control.id).status, 'running');
    assert.equal(f.version(), version);
    assert.equal(f.store.records(f.run.id, 'control_result').length, 0);
    assert.equal(f.store.records(f.run.id, 'artifact').length, artifacts);
    db.exec('DROP TRIGGER fail_review');
    assert.deepEqual(
      f.store.submitReview(reviewer.actor, review, k, version),
      review,
    );
    assert.deepEqual(
      f.store.submitReview(reviewer.actor, review, k, version),
      review,
    );
    assert.equal(f.store.records(f.run.id, 'control_result').length, 1);
    assert.equal(f.store.records(f.run.id, 'artifact').length, artifacts + 1);
  } finally {
    db.close();
  }
});

test('configuration explicitly applied by the locked service persists without rewriting project identity or work', (t) => {
  const f = fixture(t),
    spec = f.task('task:preserved', 'documenter', [f.criteria[0]]);
  const before = structuredClone(f.store.project),
    run = f.store.getRun(f.run.id),
    state = f.store.getTask(spec.id);
  const config: ProjectConfig = {
    ...structuredClone(before.config),
    max_active_agents: 3,
    orchestrator: {
      ...before.config.orchestrator,
      model: 'fixture:configured',
    },
  };
  f.store.configureProject(config);
  config.max_active_agents = 7;
  assert.equal(f.store.project.config.max_active_agents, 3);
  const reopened = new Store(f.project);
  t.after(() => reopened.close());
  const { config: previousConfig, ...previousIdentity } = before;
  const { config: currentConfig, ...currentIdentity } = reopened.project;
  assert.deepEqual(currentIdentity, previousIdentity);
  assert.equal(currentConfig.max_active_agents, 3);
  assert.equal(currentConfig.orchestrator.model, 'fixture:configured');
  assert.deepEqual(reopened.getRun(f.run.id), run);
  assert.deepEqual(reopened.getTask(spec.id), state);
  assert.throws(
    () => f.store.configureProject({ ...previousConfig, max_active_agents: 0 }),
    code('INVALID_INPUT'),
  );
  assert.throws(
    () => f.store.configureProject('{' as unknown as ProjectConfig),
    code('INVALID_INPUT'),
  );
  assert.deepEqual(f.store.project.config, currentConfig);
  assert.deepEqual(reopened.getRun(f.run.id), run);
});

function amendedSameSnapshot(f: ReturnType<typeof fixture>) {
  const original = f.task('task:writer', 'documenter', f.criteria);
  const previous = f.claim(original),
    oldHandoff = f.deliver(original, previous, [f.criteria[0].id]);
  f.stop(previous.attempt.id);
  const previousEvidence = f.proof(
    { ...original, acceptance_criteria: [f.criteria[0]] },
    previous,
    oldHandoff,
  );
  const decision = f.decision(original.id);
  const updated = f.store.amendTask(
    f.chief,
    {
      task: { ...original, acceptance_criteria: [f.criteria[0]] },
      reason:
        'The independent reviewer will cover the original global review criterion',
      decision_id: decision.id,
    },
    f.key(),
    f.version(),
  );
  f.store.reassignTask(f.user, original.id, f.key(), f.version());
  const current = f.claim(updated.spec),
    handoff = f.deliver(updated.spec, current);
  f.stop(current.attempt.id);
  assert.equal(
    handoff.source_revision,
    oldHandoff.source_revision,
    'The regression must keep the actual document bytes and SHA identical',
  );
  assert.notEqual(current.attempt.id, previous.attempt.id);
  assert.ok(current.attempt.generation > previous.attempt.generation);
  assert.deepEqual(
    f.store.getRun(f.run.id).acceptance_criteria,
    f.run.acceptance_criteria,
  );
  return {
    original,
    previous,
    previousEvidence,
    current,
    handoff,
    spec: updated.spec,
  };
}

test('an amended same-SHA delivery rejects previous-attempt evidence and completes only with fresh writer and linked control proofs', (t) => {
  const f = fixture(t),
    state = amendedSameSnapshot(f);
  const staleControl = f.task('task:stale-proof-review', 'reviewer', [
      f.criteria[1],
    ]),
    staleReviewer = f.claim(staleControl);
  const staleReview = f.review(staleControl, staleReviewer, state.handoff, [
    state.previousEvidence.value.id,
  ]);
  f.stop(staleReviewer.attempt.id);
  const staleResult = f.store
    .records<ControlResult>(f.run.id, 'control_result')
    .find((item) => item.review_id === staleReview.id)!;
  const before = f.version();
  assert.throws(
    () =>
      f.store.acceptDelivery(
        f.chief,
        {
          handoff_id: state.handoff.id,
          review_ids: [staleReview.id],
          verification_ids: [state.previousEvidence.value.id],
          accepted_revision: state.handoff.source_revision!,
        },
        f.key(),
        f.version(),
      ),
    code('STALE_EVIDENCE'),
  );
  assert.equal(f.version(), before);
  assert.equal(f.store.getTask(state.spec.id).status, 'in_review');
  assert.equal(f.store.records(f.run.id, 'acceptance').length, 0);
  const currentEvidence = f.proof(state.spec, state.current, state.handoff);
  assert.deepEqual(currentEvidence.value.criterion_ids, [f.criteria[0].id]);
  assert.equal(
    currentEvidence.artifact.producer_attempt_id,
    state.current.attempt.id,
  );
  const control = f.task('task:fresh-proof-review', 'reviewer', [
      f.criteria[1],
    ]),
    reviewer = f.claim(control);
  const review = f.review(control, reviewer, state.handoff, [
    currentEvidence.value.id,
  ]);
  f.stop(reviewer.attempt.id);
  assert.equal(
    f.store.acceptDelivery(
      f.chief,
      {
        handoff_id: state.handoff.id,
        review_ids: [review.id],
        verification_ids: [currentEvidence.value.id],
        accepted_revision: state.handoff.source_revision!,
      },
      f.key(),
      f.version(),
    ).status,
    'accepted',
  );
  const currentResult = f.store
    .records<ControlResult>(f.run.id, 'control_result')
    .find((item) => item.review_id === review.id)!;
  const args: FinishRunArgs = {
    summary:
      'Unchanged bytes still require current-attempt observations and the accepted independent control',
    criterion_evidence: [
      {
        criterion_id: f.criteria[0].id,
        evidence_artifact_ids: [currentEvidence.artifact.id],
      },
      {
        criterion_id: f.criteria[1].id,
        evidence_artifact_ids: [staleResult.artifact_id],
      },
    ],
    delivered_artifact_ids: [state.handoff.artifacts[0]!.id],
  };
  assert.throws(
    () => f.store.finishRun(f.chief, args, f.key(), f.version()),
    code('MISSING_EVIDENCE'),
  );
  args.criterion_evidence[1]!.evidence_artifact_ids = [
    currentResult.artifact_id,
  ];
  assert.equal(
    f.store.finishRun(f.chief, args, f.key(), f.version()).status,
    'completed',
  );
  assert.deepEqual(
    f.store.getRun(f.run.id).acceptance_criteria,
    f.run.acceptance_criteria,
  );
});

test('current-attempt proof cannot recycle a criterion removed from the amended TaskSpec', (t) => {
  const f = fixture(t),
    state = amendedSameSnapshot(f);
  const outOfScope = f.proof(state.original, state.current, state.handoff);
  assert.deepEqual(
    outOfScope.value.criterion_ids,
    f.criteria.map((item) => item.id),
  );
  assert.equal(
    outOfScope.artifact.producer_attempt_id,
    state.current.attempt.id,
    'Only criterion scope, not attempt ownership, is invalid in this case',
  );
  const control = f.task('task:out-of-scope-review', 'reviewer', [
      f.criteria[1],
    ]),
    reviewer = f.claim(control);
  const review = f.review(control, reviewer, state.handoff, [
    outOfScope.value.id,
  ]);
  f.stop(reviewer.attempt.id);
  const before = f.version();
  assert.throws(
    () =>
      f.store.acceptDelivery(
        f.chief,
        {
          handoff_id: state.handoff.id,
          review_ids: [review.id],
          verification_ids: [outOfScope.value.id],
          accepted_revision: state.handoff.source_revision!,
        },
        f.key(),
        f.version(),
      ),
    code('STALE_EVIDENCE'),
  );
  assert.equal(f.version(), before);
  assert.equal(f.store.getTask(state.spec.id).status, 'in_review');
  assert.deepEqual(f.store.getTask(state.spec.id).spec.acceptance_criteria, [
    f.criteria[0],
  ]);
  assert.deepEqual(
    f.store.getRun(f.run.id).acceptance_criteria,
    f.run.acceptance_criteria,
  );
});
