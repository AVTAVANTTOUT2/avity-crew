import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validate } from '../packages/contracts/src/index.ts';
import type { TaskSpec } from '../packages/contracts/src/index.ts';

const task = JSON.parse(
  readFileSync(
    new URL(
      '../../tests/fixtures/contracts/task.example.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as TaskSpec;
const args = {
  task: {
    ...task,
    acceptance_criteria: [
      {
        ...task.acceptance_criteria[0]!,
        description:
          'Produce the document; independent review has its own mission.',
      },
    ],
  },
  reason:
    'Separate the writer deliverable from the independent review and run closure.',
  decision_id: 'decision:separate-review',
};
const call = (arguments_: unknown) => ({
  schema_version: 1,
  request_id: 'request:amend',
  idempotency_key: 'amend:writer-scope',
  run_id: task.run_id,
  expected_version: 2,
  method: 'amend_task',
  arguments: arguments_,
});

test('amend_task carries a complete TaskSpec, reason and decision reference in the common request envelope', () => {
  validate('ToolCall', call(args));
  validate('TaskSpec', args.task);
  assert.equal(args.task.id, task.id);
  assert.equal(args.task.run_id, task.run_id);
});

test('amend_task rejects incomplete arguments, invalid identifiers and attempts to add Run controls', () => {
  const { task: _task, ...withoutTask } = args;
  const { reason: _reason, ...withoutReason } = args;
  const { decision_id: _decision, ...withoutDecision } = args;
  const { objective: _objective, ...incompleteTask } = task;
  for (const invalid of [
    withoutTask,
    withoutReason,
    withoutDecision,
    { ...args, task: incompleteTask },
    { ...args, reason: '' },
    { ...args, reason: null },
    { ...args, decision_id: '' },
    { ...args, decision_id: 'decision/forged' },
    { ...args, task: null },
    { ...args, run: { objective: 'Drop the original objective' } },
    { ...args, run_acceptance_criteria: [] },
    { ...args, approved: true },
    { ...args, task: { ...task, run_acceptance_criteria: [] } },
  ])
    assert.throws(() => validate('ToolCall', call(invalid)), {
      code: 'INVALID_INPUT',
    });
});

test('legacy ToolCalls remain valid and amendment never accepts a body Actor or an unversioned request', () => {
  const legacy = JSON.parse(
    readFileSync(
      new URL(
        '../../tests/fixtures/contracts/tool-call.example.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  validate('ToolCall', legacy);
  for (const invalid of [
    { ...call(args), actor: { role: 'chief' } },
    { ...call(args), expected_version: -1 },
    { ...call(args), expected_version: 1.5 },
    { ...call(args), idempotency_key: '' },
  ])
    assert.throws(() => validate('ToolCall', invalid), {
      code: 'INVALID_INPUT',
    });
});
