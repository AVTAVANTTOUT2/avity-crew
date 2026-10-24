import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, CrewError } from '../packages/contracts/src/index.ts';
import type {
  TaskSpec,
  Handoff,
  Attempt,
  ProviderRequest,
  TaskState,
  Run,
  Verification,
} from '../packages/contracts/src/index.ts';
import {
  assertTransition,
  assertCurrentAttempt,
  assertAcyclic,
  assertRunCompletable,
  assertRunTransition,
  assertLiveVerification,
} from '../packages/core/src/index.ts';
import { FakeProvider } from '../packages/providers/src/index.ts';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../tests/fixtures/contracts/${name}.example.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  );

test('published runtime examples validate without provider-specific types', () => {
  for (const [file, definition] of [
    ['task', 'TaskSpec'],
    ['handoff', 'Handoff'],
    ['context', 'ContextBundle'],
    ['event', 'CrewEvent'],
    ['tool-call', 'ToolCall'],
  ] as const)
    validate(definition, fixture(file));
});

test('missing IDs, unsupported versions and extra fields are rejected', () => {
  const task = fixture('task') as TaskSpec;
  const { id: _id, ...withoutId } = task;
  for (const invalid of [
    withoutId,
    { ...task, id: '' },
    { ...task, schema_version: 99 },
    { ...task, unexpected: true },
  ])
    assert.throws(
      () => validate('TaskSpec', invalid),
      (error: unknown) =>
        error instanceof CrewError && error.code === 'INVALID_INPUT',
    );
  assert.throws(
    () => validate('TaskSpec/properties/id' as never, 'text'),
    (error: unknown) =>
      error instanceof CrewError && error.code === 'UNKNOWN_SCHEMA',
  );
});

test('project configuration follows the published schema and rejects an impossible capacity', () => {
  const config = fixture('project-config') as Record<string, unknown>;
  validate('ProjectConfig', config);
  assert.throws(
    () => validate('ProjectConfig', { ...config, max_active_agents: 0 }),
    /Invalid ProjectConfig/,
  );
});

test('process success cannot directly accept a task, and acceptance is terminal', () => {
  assert.throws(() => assertTransition('running', 'accepted'), /not allowed/);
  assert.throws(() => assertTransition('accepted', 'running'), /not allowed/);
  assert.doesNotThrow(() => assertTransition('running', 'in_review'));
});

test('stale and foreign delivery attempts cannot advance the task', () => {
  const handoff = fixture('handoff') as Handoff;
  const attempt: Attempt = {
    id: handoff.attempt_id,
    run_id: handoff.run_id,
    task_id: handoff.task_id,
    session_id: 'session:test',
    generation: handoff.generation,
    status: 'running',
    started_at: handoff.created_at,
    heartbeat_at: handoff.created_at,
    ended_at: null,
    exit_code: null,
    pid: null,
  };
  const task: TaskState = {
    id: handoff.task_id,
    run_id: handoff.run_id,
    spec: fixture('task') as TaskSpec,
    status: 'running',
    version: 1,
    generation: attempt.generation,
    active_attempt_id: attempt.id,
    wait_reason: null,
    accepted_revision: null,
  };
  assert.doesNotThrow(() => assertCurrentAttempt(handoff, attempt, task));
  assert.throws(
    () =>
      assertCurrentAttempt(
        { ...handoff, generation: handoff.generation + 1 },
        attempt,
        task,
      ),
    /current attempt/,
  );
  assert.throws(
    () =>
      assertCurrentAttempt({ ...handoff, run_id: 'run:other' }, attempt, task),
    /current attempt/,
  );
  assert.throws(
    () =>
      assertCurrentAttempt(
        handoff,
        { ...attempt, status: 'exited' },
        {
          ...task,
          active_attempt_id: 'attempt:new',
          generation: task.generation + 1,
        },
      ),
    (error: unknown) =>
      error instanceof CrewError && error.code === 'STALE_ATTEMPT',
  );
  assert.throws(
    () =>
      assertCurrentAttempt(
        handoff,
        { ...attempt, status: 'interrupted' },
        task,
      ),
    (error: unknown) =>
      error instanceof CrewError && error.code === 'INACTIVE_ATTEMPT',
  );
  assert.throws(
    () =>
      assertCurrentAttempt(
        {
          ...handoff,
          artifacts: handoff.artifacts.map((a) => ({
            ...a,
            producer_attempt_id: 'attempt:other',
          })),
        },
        attempt,
        task,
      ),
    (error: unknown) =>
      error instanceof CrewError && error.code === 'WRONG_PRODUCER',
  );
});

test('an interrupted stream cannot report its previously planned success', async () => {
  const handle = new FakeProvider([
    { type: 'text', text: 'partial', provenance: 'simulated' },
    { type: 'result', success: true, provenance: 'simulated' },
  ]).start({
    cwd: process.cwd(),
    prompt: 'test',
    model: null,
    role: 'developer',
    permissions: { sandbox: 'read-only', approval: 'never' },
  });
  const iterator = handle.events[Symbol.asyncIterator]();
  await iterator.next();
  await handle.interrupt();
  const result = await handle.result;
  assert.equal(result.success, false);
  assert.equal(result.text, 'partial');
  assert.equal(result.signal, 'SIGINT');
  await iterator.return?.();
});

test('run completion requires accepted tasks and passing criterion evidence', () => {
  const spec = fixture('task') as TaskSpec;
  const proof = (fixture('handoff') as Handoff).verifications[0]!;
  const task: TaskState = {
    id: spec.id,
    run_id: spec.run_id,
    spec,
    status: 'accepted',
    version: 1,
    generation: 1,
    active_attempt_id: null,
    wait_reason: null,
    accepted_revision: proof.tested_revision,
  };
  const run: Run = {
    id: spec.run_id,
    project_id: 'project:test',
    objective: spec.objective,
    constraints: [],
    acceptance_criteria: [
      {
        id: 'criterion:test',
        description: 'Works',
        required: true,
        verification: 'test',
      },
    ],
    delivery_mode: 'code',
    status: 'validating',
    chief_provider: 'codex',
    chief_model: null,
    generation: 1,
    version: 1,
    max_active_agents: 1,
    created_at: spec.created_at,
    updated_at: spec.created_at,
  };
  const verification: Verification = {
    ...proof,
    criterion_ids: ['criterion:test'],
    result: 'passed',
  };
  assert.throws(
    () => assertRunTransition('running', 'completed'),
    /not allowed/,
  );
  assert.throws(
    () =>
      assertRunCompletable(
        run,
        [{ ...task, status: 'in_review' }],
        [verification],
      ),
    /must be accepted/,
  );
  assert.throws(
    () =>
      assertRunCompletable(
        run,
        [task],
        [{ ...verification, result: 'failed' }],
      ),
    /lack passing evidence/,
  );
  assert.doesNotThrow(() => assertRunCompletable(run, [task], [verification]));
});

test('simulation cannot satisfy a required live verification', () => {
  const proof = (fixture('handoff') as Handoff).verifications[0]!;
  assert.throws(
    () =>
      assertLiveVerification({ ...proof, mode: 'simulated', provider: 'fake' }),
    /Simulation cannot satisfy/,
  );
  assert.throws(
    () => assertLiveVerification({ ...proof, mode: 'live', provider: 'fake' }),
    /Simulation cannot satisfy/,
  );
  assert.doesNotThrow(() =>
    assertLiveVerification({ ...proof, mode: 'live', provider: 'claude' }),
  );
});

test('cycles and missing dependencies are rejected with a useful path', () => {
  assert.throws(
    () =>
      assertAcyclic(
        new Map([
          ['one', ['two']],
          ['two', ['one']],
        ]),
      ),
    /one → two → one/,
  );
  assert.throws(
    () => assertAcyclic(new Map([['one', ['missing']]])),
    /Unknown dependency/,
  );
  assert.doesNotThrow(() =>
    assertAcyclic(
      new Map([
        ['one', []],
        ['two', ['one']],
      ]),
    ),
  );
});

test('fake events and result always remain simulated; unknown native event is representable', async () => {
  const provider = new FakeProvider([
    { type: 'unknown', provenance: 'simulated', text: 'future native event' },
    { type: 'result', provenance: 'simulated', success: true },
  ]);
  const request: ProviderRequest = {
    cwd: process.cwd(),
    prompt: 'test',
    model: null,
    role: 'developer',
    permissions: { sandbox: 'read-only', approval: 'never' },
  };
  const processHandle = provider.start(request);
  await assert.rejects(
    processHandle.send('new decision'),
    /cannot receive input/,
  );
  for await (const event of processHandle.events)
    assert.equal(event.provenance, 'simulated');
  assert.equal((await processHandle.result).provenance, 'simulated');
  validate('ProviderCapabilities', await provider.probe());
  assert.throws(
    () => provider.resume({ ...request, native_session_id: 'exact-id' }),
    /no native conversation/,
  );
});

test('an interrupted simulated process cannot report success', async () => {
  const processHandle = new FakeProvider().start({
    cwd: process.cwd(),
    prompt: 'test',
    model: null,
    role: 'developer',
    permissions: { sandbox: 'read-only', approval: 'never' },
  });
  await processHandle.interrupt();
  const result = await processHandle.result;
  assert.equal(result.success, false);
  assert.equal(result.signal, 'SIGINT');
  assert.equal(result.provenance, 'simulated');
});
