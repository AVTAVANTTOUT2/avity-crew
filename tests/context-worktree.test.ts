import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CrewError } from '../packages/contracts/src/index.ts';
import type { TaskSpec } from '../packages/contracts/src/index.ts';
import { FakeProvider } from '../packages/providers/src/fake.ts';
import {
  compileContext,
  inspectCompiledContext,
  inspectProject,
  reconcileSources,
  selectTaskSources,
} from '../packages/context/src/index.ts';

const git = (root: string, ...args: string[]) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).replace(/\r?\n$/, '');
const hash = (content: string) =>
  `sha256:${createHash('sha256').update(content).digest('hex')}`;
const date = '2026-10-24T12:00:00.000Z';

async function fixture(t: TestContext) {
  const directory = mkdtempSync(
    join(tmpdir(), 'crew pinned source worktrees '),
  );
  const chiefRoot = join(directory, 'chief project'),
    workerRoot = join(directory, 'worker checkout');
  mkdirSync(join(chiefRoot, 'src'), { recursive: true });
  const instruction =
    '# Project instructions\nPINNED_WORKTREE_CONTRACT_V1: preserve authorization and the original acceptance criteria.\n';
  writeFileSync(join(chiefRoot, 'AGENTS.md'), instruction);
  writeFileSync(
    join(chiefRoot, 'src/job.ts'),
    'export const job = "fixture";\n',
  );
  git(chiefRoot, 'init', '--initial-branch=main');
  git(chiefRoot, 'add', '--all');
  git(
    chiefRoot,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@localhost',
    'commit',
    '-m',
    'pinned instruction baseline',
  );
  git(chiefRoot, 'worktree', 'add', '--detach', workerRoot, 'HEAD');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal(
    git(chiefRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
    git(workerRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
  );
  const chief = await inspectProject(chiefRoot, { observed_at: date });
  const source = chief.sources.find(
    (item) => item.source.reference === 'AGENTS.md',
  )!.source;
  assert.equal(source.kind, 'instruction');
  assert.equal(source.revision, hash(instruction));
  const spec: TaskSpec = {
    schema_version: 1,
    id: 'task:worker',
    run_id: 'run:worktree',
    title: 'Preserve the pinned instruction in an isolated worker',
    objective:
      'Perform the scoped mission under the original instruction contract',
    role: 'developer',
    acceptance_criteria: [
      {
        id: 'criterion:contract',
        description:
          'Keep the required AGENTS.md instruction and its pinned hash',
        required: true,
        verification: 'Real linked-worktree context compilation',
      },
    ],
    depends_on: [],
    scope: { read_paths: ['src/'], write_paths: ['src/'], excluded_paths: [] },
    base_revision: chief.git.revision,
    context_source_ids: [source.id],
    expected_deliverables: [
      'A source change respecting the pinned instruction',
    ],
    created_at: date,
  };
  return { chiefRoot, workerRoot, instruction, source, spec };
}

test('a required instruction from the chief resolves in a real linked worker worktree with its pinned bytes and provenance', async (t) => {
  const f = await fixture(t);
  const worker = await inspectProject(f.workerRoot, { observed_at: date });
  const current = worker.sources.find(
    (item) => item.source.reference === 'AGENTS.md',
  )!.source;
  assert.notEqual(
    current.id,
    f.source.id,
    'Source IDs retain their root-specific namespace',
  );
  assert.equal(current.revision, f.source.revision);
  const selection = await selectTaskSources(worker, f.spec, [f.source]);
  const compiled = compileContext({
    id: 'context:worker',
    version: 1,
    created_at: date,
    actor: {
      id: 'crew:worker',
      project_id: 'project:linked',
      run_id: f.spec.run_id,
      role: 'developer',
      task_id: f.spec.id,
      attempt_id: 'attempt:worker',
      generation: 1,
    },
    orchestrator_id: 'crew:chief',
    workspace_path: f.workerRoot,
    task: f.spec,
    selection,
    provider: await new FakeProvider().probe(),
    run: {
      id: f.spec.run_id,
      objective: 'Delegate under the exact required project instruction',
      constraints: ['Never drop a required source to make the context compile'],
      acceptance_criteria: f.spec.acceptance_criteria,
      delivery_mode: 'code',
    },
    decisions: [],
    messages: [],
    execution_policy: { sandbox: 'workspace-write', approval: 'never' },
    available_tools: [
      {
        name: 'inspect_project',
        description: 'Inspect the current scoped source',
      },
      {
        name: 'submit_handoff',
        description: 'Submit actual source and evidence',
      },
    ],
    dependencies: [],
    budget: { context_window_tokens: 24_000, reserve_tokens: 4000 },
  });
  assert.deepEqual(selection.replacements, [
    {
      previous_id: f.source.id,
      current_id: current.id,
      reference: 'AGENTS.md',
    },
  ]);
  const selected = selection.sources.find(
    (item) => item.source.reference === 'AGENTS.md',
  )!;
  assert.equal(selected.reason, `required_source:${f.source.id}`);
  assert.equal(selected.content, f.instruction);
  assert.equal(selected.source.revision, f.source.revision);
  assert.deepEqual(f.spec.context_source_ids, [f.source.id]);
  assert.match(compiled.prompt, /PINNED_WORKTREE_CONTRACT_V1/);
  const mission = JSON.parse(compiled.bundle.layers.mission);
  assert.deepEqual(mission.task.context_source_ids, [f.source.id]);
  assert.ok(mission.applicable_instructions.includes(current.id));
  assert.deepEqual(mission.source_replacements, selection.replacements);
  assert.equal(
    compiled.bundle.sources.find((source) => source.id === current.id)!
      .revision,
    f.source.revision,
  );
  assert.equal(inspectCompiledContext(compiled).prompt, compiled.prompt);
  const revalidated = await reconcileSources([f.source], worker, [f.spec]);
  assert.equal(revalidated.changes[0]!.status, 'current');
  assert.deepEqual(revalidated.affected_task_ids, []);
});

test('changed required instruction bytes are reported stale with both hashes retained and cannot be removed by a scope exclusion', async (t) => {
  const f = await fixture(t);
  const changed =
    '# Project instructions\nPINNED_WORKTREE_CONTRACT_V2: a deliberately changed contract requires reconciliation.\n';
  writeFileSync(join(f.workerRoot, 'AGENTS.md'), changed);
  const worker = await inspectProject(f.workerRoot, { observed_at: date });
  const revalidated = await reconcileSources([f.source], worker, [f.spec]);
  assert.equal(revalidated.changes.length, 1);
  const change = revalidated.changes[0]!;
  assert.equal(change.status, 'modified');
  assert.equal(change.previous.id, f.source.id);
  assert.equal(change.previous.revision, hash(f.instruction));
  assert.equal(change.current!.source.reference, 'AGENTS.md');
  assert.equal(change.current!.source.revision, hash(changed));
  assert.notEqual(change.current!.source.revision, f.source.revision);
  assert.deepEqual(revalidated.affected_task_ids, [f.spec.id]);
  assert.deepEqual(f.spec.context_source_ids, [f.source.id]);
  assert.equal(
    readFileSync(join(f.chiefRoot, 'AGENTS.md'), 'utf8'),
    f.instruction,
  );
  await assert.rejects(
    selectTaskSources(
      worker,
      { ...f.spec, scope: { ...f.spec.scope, excluded_paths: ['AGENTS.md'] } },
      [f.source],
    ),
    (error: unknown) =>
      error instanceof CrewError && error.code === 'EXCLUDED_SOURCE',
  );
});
