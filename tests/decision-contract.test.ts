import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { now, validate } from '../packages/contracts/src/index.ts';
import type { Actor, Decision, Run } from '../packages/contracts/src/index.ts';
import {
  compileContext,
  inspectProject,
} from '../packages/context/src/index.ts';
import { FakeProvider } from '../packages/providers/src/fake.ts';
import { identifyProject, Store } from '../packages/storage/src/index.ts';

const decision = (runId = 'run:decision'): Decision => ({
  schema_version: 1,
  id: 'decision:correction',
  run_id: runId,
  question: 'Which correction strategy?',
  answer: 'Preserve the failed evidence and verify a new attempt.',
  status: 'approved',
  approved_by: 'user:local',
  source_ids: [],
  affects_task_ids: [],
  supersedes: null,
  created_at: now(),
});

test('Decision keeps legacy records valid and accepts only a strict optional provenance shape', () => {
  const legacy = decision();
  validate('Decision', legacy);
  for (const provenance of [
    { basis: 'technical_judgment', user_response_id: null },
    { basis: 'user_response', user_response_id: 'response:one' },
  ])
    validate('Decision', { ...legacy, provenance });
  for (const provenance of [
    null,
    [],
    'technical_judgment',
    {},
    { basis: 'technical_judgment' },
    { user_response_id: null },
    { basis: 'invented', user_response_id: null },
    { basis: 'user_response', user_response_id: 42 },
    {
      basis: 'technical_judgment',
      user_response_id: null,
      approved_by: 'user:forged',
    },
  ])
    assert.throws(() => validate('Decision', { ...legacy, provenance }), {
      code: 'INVALID_INPUT',
    });
  assert.throws(() => validate('Decision', { ...legacy, unexpected: true }), {
    code: 'INVALID_INPUT',
  });
});

test('a Decision read back from Store validates and compiles without dropping its provenance', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'avity decision contract '));
  const root = join(directory, 'project');
  await mkdir(root);
  const project = identifyProject(root, join(directory, 'state'));
  const store = new Store(project);
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const run: Run = {
    id: 'run:decision',
    project_id: project.id,
    objective: 'Apply the verified correction strategy',
    constraints: [],
    acceptance_criteria: [
      {
        id: 'criterion:correction',
        description: 'New evidence verifies the correction',
        required: true,
        verification: 'tests',
      },
    ],
    delivery_mode: 'documentation',
    status: 'planning',
    chief_provider: 'codex',
    chief_model: null,
    generation: 1,
    version: 0,
    max_active_agents: 1,
    created_at: now(),
    updated_at: now(),
  };
  store.createRun(run, 'create:run');
  const user: Actor = {
    id: 'user:local',
    project_id: project.id,
    run_id: run.id,
    role: 'user',
    task_id: null,
    attempt_id: null,
    generation: 1,
  };
  const original = decision(run.id);
  store.recordDecision(
    user,
    original,
    'record:decision',
    store.getRun(run.id).version,
  );
  const decisions = store.records<Decision>(run.id, 'decision');
  const expected = {
    ...original,
    provenance: { basis: 'technical_judgment', user_response_id: null },
  };
  assert.deepEqual(decisions, [expected]);
  validate('Decision', decisions[0]);
  const compiled = compileContext({
    id: 'context:decision',
    version: 1,
    created_at: now(),
    actor: {
      ...user,
      id: 'crew:chief',
      role: 'chief',
      attempt_id: 'attempt:chief',
    },
    orchestrator_id: 'crew:chief',
    workspace_path: project.root,
    run,
    decisions,
    messages: [],
    selection: {
      project: await inspectProject(root),
      sources: [],
      exclusions: [],
      replacements: [],
    },
    provider: await new FakeProvider().probe(),
    execution_policy: { sandbox: 'read-only', approval: 'never' },
    available_tools: [],
    dependencies: [],
    budget: { context_window_tokens: 20000, reserve_tokens: 2000 },
  });
  assert.deepEqual(compiled.bundle.decision_ids, [original.id]);
  assert.ok(compiled.prompt.includes(original.answer));
  assert.deepEqual(
    decisions,
    [expected],
    'context compilation must not strip stored provenance',
  );
});

test('package and published workpack runtime schemas stay structurally identical', async () => {
  const read = async (path: string) =>
    JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  assert.deepEqual(
    await read('../../packages/contracts/schema/runtime.schema.json'),
    await read('../../avity-crew-workpack/schemas/runtime.schema.json'),
  );
});
