import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, CrewError } from '../packages/contracts/src/index.ts';
import type {
  TaskSpec,
  Handoff,
  Attempt,
  ProviderRequest,
} from '../packages/contracts/src/index.ts';
import {
  assertTransition,
  assertCurrentAttempt,
  assertAcyclic,
} from '../packages/core/src/index.ts';
import { FakeProvider } from '../packages/providers/src/index.ts';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../avity-crew-workpack/examples/${name}.example.json`,
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
  for (const invalid of [
    { ...task, id: '' },
    { ...task, schema_version: 99 },
    { ...task, unexpected: true },
  ])
    assert.throws(() => validate('TaskSpec', invalid), CrewError);
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
  assert.doesNotThrow(() => assertCurrentAttempt(handoff, attempt));
  assert.throws(
    () =>
      assertCurrentAttempt(
        { ...handoff, generation: handoff.generation + 1 },
        attempt,
      ),
    /current attempt/,
  );
  assert.throws(
    () => assertCurrentAttempt({ ...handoff, run_id: 'run:other' }, attempt),
    /current attempt/,
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
