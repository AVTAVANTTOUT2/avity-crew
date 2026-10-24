import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  watch,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Store, identifyProject } from '../packages/storage/src/index.ts';
import { CrewError, now } from '../packages/contracts/src/index.ts';
import type {
  Actor,
  Run,
  TaskSpec,
  AgentSession,
  ArtifactRef,
  Handoff,
} from '../packages/contracts/src/index.ts';
import {
  WorkspaceManager,
  inspectRepository,
  reserveResources,
} from '../packages/workspace/src/index.ts';
import type { Check, Delivery } from '../packages/workspace/src/index.ts';
import { runCommand } from '../packages/workspace/src/git.ts';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).replace(/\r?\n$/, '');
const code = (expected: string) => (error: unknown) =>
  error instanceof CrewError && error.code === expected;
const check = (source: string): Check[] => [
  { id: 'check:fixture', command: [process.execPath, '-e', source] },
];

function fixture(t: TestContext, initialize = true) {
  const directory = mkdtempSync(join(tmpdir(), 'avity crew workspace ')),
    root = join(directory, 'project with spaces');
  mkdirSync(root);
  writeFileSync(join(root, 'base.txt'), 'baseline\n');
  if (initialize) {
    git(root, 'init', '--initial-branch=main');
    git(root, 'add', '--all');
    git(
      root,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@localhost',
      'commit',
      '-m',
      'baseline',
    );
  }
  const project = identifyProject(root, join(directory, 'data'));
  let store = new Store(project);
  const run: Run = {
    id: 'run:workspace',
    project_id: project.id,
    objective: 'Verify workspaces',
    constraints: [],
    acceptance_criteria: [
      {
        id: 'criterion:workspace',
        description: 'Preserve work',
        required: true,
        verification: 'test',
      },
    ],
    delivery_mode: 'code',
    status: 'planning',
    chief_provider: 'codex',
    chief_model: null,
    generation: 1,
    version: 0,
    max_active_agents: 7,
    created_at: now(),
    updated_at: now(),
  };
  store.createRun(run, 'run:create');
  const actor: Actor = {
    id: 'user:local',
    project_id: project.id,
    run_id: run.id,
    role: 'user',
    task_id: null,
    attempt_id: null,
    generation: 1,
  };
  const manager = new WorkspaceManager(store, actor);
  let sequence = 0;
  const version = () => store.getRun(run.id).version;
  const task = (writePaths = ['**']) => {
    const id = `task:workspace${++sequence}`;
    const spec: TaskSpec = {
      schema_version: 1,
      id,
      run_id: run.id,
      title: id,
      objective: 'Change a fixture',
      role: 'developer',
      acceptance_criteria: [run.acceptance_criteria[0]!],
      depends_on: [],
      scope: {
        read_paths: ['**'],
        write_paths: writePaths,
        excluded_paths: [],
      },
      base_revision: initialize
        ? `git:${git(root, 'rev-parse', 'HEAD')}`
        : null,
      context_source_ids: [],
      expected_deliverables: ['Immutable snapshot'],
      created_at: now(),
    };
    store.createTask(actor, spec, `task:create${sequence}`, version());
    const session: AgentSession = {
      id: `session:workspace${sequence}`,
      run_id: run.id,
      task_id: id,
      provider: 'codex',
      model: null,
      native_session_id: null,
      cli_version: null,
      cwd: root,
      capabilities: null,
    };
    const attempt = store.claimTask(
      actor,
      id,
      session,
      `task:claim${sequence}`,
      version(),
    );
    return {
      taskId: id,
      attemptId: attempt.id,
      baseRevision: spec.base_revision,
    };
  };
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    root,
    project,
    get store() {
      return store;
    },
    actor,
    run,
    manager,
    task,
    version,
    reopen() {
      store.close();
      store = new Store(project);
      return store;
    },
  };
}

async function resumedPartialFixture(t: TestContext) {
  const f = fixture(t),
    initial = f.task(['ui/**', 'README.md']);
  f.store.observeAttempt(
    f.actor,
    initial.attemptId,
    { status: 'running', pid: null, exit_code: null },
    'attempt:partial-running',
    f.version(),
  );
  const first = await f.manager.createWorkspace(
    { ...initial, mode: 'code' },
    'workspace:partial',
  );
  mkdirSync(join(first.path, 'ui'));
  writeFileSync(
    join(first.path, 'ui/index.html'),
    '<main>Recovered UI</main>\n',
  );
  writeFileSync(join(first.path, 'README.md'), 'Draft README\n');
  const partial = await f.manager.collectDelivery(
    first.operationId,
    { writePaths: ['ui/**', 'README.md'] },
    'delivery:partial',
  );
  const submit = (
    delivery: Delivery,
    attemptId: string,
    status: Handoff['status'],
    id: string,
  ) => {
    const attempt = f.store.getAttempt(attemptId);
    const actor: Actor = {
      ...f.actor,
      id: attempt.session_id,
      role: 'developer',
      task_id: initial.taskId,
      attempt_id: attempt.id,
      generation: attempt.generation,
    };
    assert.ok(delivery.preservationRef);
    const artifact: ArtifactRef = {
      id: `artifact:${id}`,
      kind: 'git_commit',
      reference: delivery.preservationRef,
      revision: delivery.sourceRevision,
      producer_attempt_id: attempt.id,
      created_at: now(),
    };
    const value: Handoff = {
      schema_version: 1,
      id,
      task_id: initial.taskId,
      run_id: f.run.id,
      attempt_id: attempt.id,
      generation: attempt.generation,
      status,
      summary:
        status === 'partial'
          ? 'UI retained; README still needs completion'
          : 'UI and final README captured cumulatively',
      source_revision: delivery.sourceRevision,
      artifacts: [artifact],
      verifications: [],
      criteria_claimed:
        status === 'partial'
          ? []
          : f.run.acceptance_criteria.map((criterion) => criterion.id),
      limitations: status === 'partial' ? ['README remains a draft'] : [],
      next_information: [],
      created_at: now(),
    };
    f.store.submitHandoff(actor, value, `submit:${id}`, f.version());
    return { actor, value };
  };
  const old = submit(partial, initial.attemptId, 'partial', 'handoff:partial');
  f.store.observeAttempt(
    f.actor,
    initial.attemptId,
    { status: 'exited', pid: null, exit_code: 0 },
    'attempt:partial-exited',
    f.version(),
  );
  f.store.reassignTask(f.actor, initial.taskId, 'task:resume', f.version());
  const session: AgentSession = {
    id: 'session:resumed',
    run_id: f.run.id,
    task_id: initial.taskId,
    provider: 'fake',
    model: null,
    native_session_id: 'simulated:resume',
    cli_version: null,
    cwd: f.root,
    capabilities: null,
  };
  const attempt = f.store.claimTask(
    f.actor,
    initial.taskId,
    session,
    'attempt:resumed',
    f.version(),
  );
  f.store.observeAttempt(
    f.actor,
    attempt.id,
    { status: 'running', pid: null, exit_code: null },
    'attempt:resumed-running',
    f.version(),
  );
  assert.ok(attempt.generation > old.value.generation);
  assert.throws(
    () =>
      f.store.submitHandoff(
        old.actor,
        { ...old.value, id: 'handoff:late-old-writer' },
        'submit:late-old-writer',
        f.version(),
      ),
    code('STALE_ATTEMPT'),
  );
  const resumed = await f.manager.createWorkspace(
    {
      taskId: initial.taskId,
      attemptId: attempt.id,
      baseRevision: partial.sourceRevision,
      mode: 'code',
    },
    'workspace:resumed',
  );
  assert.equal(
    readFileSync(join(resumed.path, 'ui/index.html'), 'utf8'),
    '<main>Recovered UI</main>\n',
  );
  assert.equal(
    readFileSync(join(resumed.path, 'README.md'), 'utf8'),
    'Draft README\n',
  );
  writeFileSync(join(resumed.path, 'README.md'), 'Final README\n');
  assert.equal(
    f.store.getTask(initial.taskId).spec.base_revision,
    initial.baseRevision,
  );
  return { f, initial, first, partial, attempt, resumed, submit };
}

test('a resumed partial delivery integrates both attempts cumulatively from the original task base', async (t) => {
  const { f, initial, first, partial, attempt, resumed, submit } =
    await resumedPartialFixture(t);
  writeFileSync(
    join(f.root, 'user note.txt'),
    'Uncommitted user work must stay intact',
  );
  const final = await f.manager.collectDelivery(
    resumed.operationId,
    { writePaths: ['ui/**', 'README.md'] },
    'delivery:final',
  );
  submit(final, attempt.id, 'delivered', 'handoff:final');
  f.store.observeAttempt(
    f.actor,
    attempt.id,
    { status: 'exited', pid: null, exit_code: 0 },
    'attempt:final-exited',
    f.version(),
  );
  const candidate = await f.manager.prepareIntegration(
    {
      targetRef: 'refs/heads/crew-cumulative-delivery',
      expectedBase: initial.baseRevision!,
      deliveryOperationIds: [final.operationId],
      checks: check(
        "const f=require('node:fs'),a=require('node:assert/strict');a.equal(f.readFileSync('ui/index.html','utf8'),'<main>Recovered UI</main>\\n');a.equal(f.readFileSync('README.md','utf8'),'Final README\\n');a.equal(f.readFileSync('base.txt','utf8'),'baseline\\n')",
      ),
    },
    'integration:cumulative',
  );
  assert.equal(
    candidate.status,
    'validated',
    'The final delivery alone must apply cleanly to the original task base and retain the UI from attempt one',
  );
  assert.equal(candidate.proofs[0]!.exitCode, 0);
  assert.equal(
    candidate.proofs[0]!.candidateRevision,
    candidate.candidateRevision,
  );
  assert.equal(final.baseRevision, initial.baseRevision);
  assert.equal(
    `git:${git(f.root, 'rev-parse', `${final.sourceRevision.slice(4)}^`)}`,
    initial.baseRevision,
  );
  assert.deepEqual(final.changedPaths.sort(), ['README.md', 'ui/index.html']);
  assert.equal(
    git(f.root, 'show', `${final.sourceRevision.slice(4)}:ui/index.html`),
    '<main>Recovered UI</main>',
  );
  assert.equal(
    git(f.root, 'show', `${final.sourceRevision.slice(4)}:README.md`),
    'Final README',
  );
  assert.equal(
    git(f.root, 'show', `${partial.sourceRevision.slice(4)}:README.md`),
    'Draft README',
  );
  await f.manager.promoteIntegration(
    candidate.operationId,
    'promote:cumulative',
  );
  assert.equal(
    git(f.root, 'rev-parse', 'refs/heads/crew-cumulative-delivery'),
    candidate.candidateRevision.slice(4),
  );
  assert.equal(`git:${git(f.root, 'rev-parse', 'HEAD')}`, initial.baseRevision);
  assert.equal(existsSync(join(f.root, 'ui')), false);
  assert.equal(existsSync(join(f.root, 'README.md')), false);
  assert.equal(
    readFileSync(join(f.root, 'user note.txt'), 'utf8'),
    'Uncommitted user work must stay intact',
  );
  assert.equal(
    readFileSync(join(first.path, 'README.md'), 'utf8'),
    'Draft README\n',
  );
  assert.equal(
    readFileSync(join(resumed.path, 'ui/index.html'), 'utf8'),
    '<main>Recovered UI</main>\n',
  );
  assert.equal(f.store.getTask(initial.taskId).active_attempt_id, attempt.id);
});

for (const restricted of [
  { name: 'narrowed write scope', scope: { writePaths: ['README.md'] } },
  {
    name: 'excluded earlier file',
    scope: { writePaths: ['ui/**', 'README.md'], excludedPaths: ['ui/**'] },
  },
]) {
  test(`resumed collection checks ${restricted.name} against cumulative changes from the task base`, async (t) => {
    const { f, partial, resumed } = await resumedPartialFixture(t);
    await assert.rejects(
      f.manager.collectDelivery(
        resumed.operationId,
        restricted.scope,
        'delivery:restricted-final',
      ),
      code('OUTSIDE_SCOPE'),
    );
    assert.equal(
      readFileSync(join(resumed.path, 'ui/index.html'), 'utf8'),
      '<main>Recovered UI</main>\n',
    );
    assert.equal(
      readFileSync(join(resumed.path, 'README.md'), 'utf8'),
      'Final README\n',
    );
    assert.equal(
      git(f.root, 'show', `${partial.sourceRevision.slice(4)}:README.md`),
      'Draft README',
    );
  });
}

test('collection refuses an amended task base that is not an ancestor of the resumed workspace base', async (t) => {
  const { f, initial, partial, attempt, resumed } =
    await resumedPartialFixture(t);
  f.store.observeAttempt(
    f.actor,
    attempt.id,
    { status: 'exited', pid: null, exit_code: 0 },
    'attempt:stopped-before-base-change',
    f.version(),
  );
  const partialSha = partial.sourceRevision.slice(4);
  const nextBase = `git:${git(f.root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit-tree', git(f.root, 'rev-parse', `${partialSha}^{tree}`), '-p', partialSha, '-m', 'new planned base after the resumed workspace was created')}`;
  f.store.recordDecision(
    f.actor,
    {
      schema_version: 1,
      id: 'decision:new-base',
      run_id: f.run.id,
      question: 'Which baseline should the next attempt use?',
      answer: 'Use the new planned baseline and create a compatible workspace',
      status: 'approved',
      approved_by: f.actor.id,
      source_ids: [],
      affects_task_ids: [initial.taskId],
      supersedes: null,
      created_at: now(),
    },
    'decision:record-base-change',
    f.version(),
  );
  f.store.amendTask(
    f.actor,
    {
      task: {
        ...f.store.getTask(initial.taskId).spec,
        base_revision: nextBase,
      },
      reason:
        'The next attempt must use the explicitly approved newer baseline',
      decision_id: 'decision:new-base',
    },
    'task:amend-base',
    f.version(),
  );
  assert.equal(f.store.getTask(initial.taskId).spec.base_revision, nextBase);
  await assert.rejects(
    f.manager.collectDelivery(
      resumed.operationId,
      { writePaths: ['ui/**', 'README.md'] },
      'delivery:incompatible-base',
    ),
    code('BASE_CHANGED'),
  );
  assert.equal(`git:${git(f.root, 'rev-parse', 'HEAD')}`, initial.baseRevision);
  assert.equal(
    readFileSync(join(resumed.path, 'ui/index.html'), 'utf8'),
    '<main>Recovered UI</main>\n',
  );
  assert.equal(
    readFileSync(join(resumed.path, 'README.md'), 'utf8'),
    'Final README\n',
  );
});

test('real worktrees isolate two deliveries and promote only their exact checked combination', async (t) => {
  const f = fixture(t),
    base = `git:${git(f.root, 'rev-parse', 'HEAD')}`;
  writeFileSync(join(f.root, 'base.txt'), 'user changes\n');
  writeFileSync(join(f.root, 'user note.txt'), 'keep me');
  const a = await f.manager.createWorkspace(
    { ...f.task(), mode: 'code' },
    'workspace:a',
  );
  const b = await f.manager.createWorkspace(
    { ...f.task(), mode: 'code' },
    'workspace:b',
  );
  assert.notEqual(a.path, b.path);
  assert.equal(readFileSync(join(a.path, 'base.txt'), 'utf8'), 'baseline\n');
  writeFileSync(join(a.path, 'feature one.txt'), 'one');
  writeFileSync(join(b.path, 'feature two.txt'), 'two');
  const da = await f.manager.collectDelivery(
    a.operationId,
    { writePaths: ['**'] },
    'delivery:a',
  );
  const db = await f.manager.collectDelivery(
    b.operationId,
    { writePaths: ['**'] },
    'delivery:b',
  );
  const request = {
    targetRef: 'refs/heads/crew-delivery',
    expectedBase: base,
    deliveryOperationIds: [da.operationId, db.operationId],
    checks: check(
      "const fs=require('node:fs'),a=require('node:assert/strict');a.equal(fs.readFileSync('feature one.txt','utf8'),'one');a.equal(fs.readFileSync('feature two.txt','utf8'),'two')",
    ),
  };
  const [candidate, replay] = await Promise.all([
    f.manager.prepareIntegration(request, 'integration:combined'),
    f.manager.prepareIntegration(request, 'integration:combined'),
  ]);
  assert.deepEqual(replay, candidate);
  assert.equal(candidate.status, 'validated');
  assert.equal(
    candidate.proofs[0]!.candidateRevision,
    candidate.candidateRevision,
  );
  assert.equal(git(f.root, 'rev-parse', request.targetRef), base.slice(4));
  const promotion = await f.manager.promoteIntegration(
    candidate.operationId,
    'promotion:combined',
  );
  assert.equal(
    git(f.root, 'rev-parse', request.targetRef),
    candidate.candidateRevision.slice(4),
  );
  assert.deepEqual(
    await f.manager.promoteIntegration(
      candidate.operationId,
      'promotion:combined',
    ),
    promotion,
  );
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), base.slice(4));
  assert.equal(
    readFileSync(join(f.root, 'base.txt'), 'utf8'),
    'user changes\n',
  );
  assert.equal(readFileSync(join(f.root, 'user note.txt'), 'utf8'), 'keep me');
});

test('immutable collection retains its snapshot and refuses scope escapes or later-work cleanup', async (t) => {
  const f = fixture(t);
  const a = await f.manager.createWorkspace(
    { ...f.task(['allowed.txt']), mode: 'code' },
    'workspace:scope',
  );
  writeFileSync(join(a.path, 'outside.txt'), 'do not lose');
  await assert.rejects(
    f.manager.collectDelivery(
      a.operationId,
      { writePaths: ['**'] },
      'delivery:outside',
    ),
    code('OUTSIDE_SCOPE'),
  );
  assert.equal(
    readFileSync(join(a.path, 'outside.txt'), 'utf8'),
    'do not lose',
  );
  const failed = f.store
    .uncertainOperations(f.run.id)
    .find((operation) => operation.kind === 'workspace.collect')!;
  assert.deepEqual((failed.result as { details: string[] }).details, [
    'outside.txt',
  ]);
  rmSync(join(a.path, 'outside.txt'));
  writeFileSync(join(a.path, 'allowed.txt'), 'snapshot');
  const delivery = await f.manager.collectDelivery(
    a.operationId,
    { writePaths: ['allowed.txt'] },
    'delivery:scope',
  );
  writeFileSync(join(a.path, 'allowed.txt'), 'later work');
  assert.equal(
    git(f.root, 'show', `${delivery.sourceRevision.slice(4)}:allowed.txt`),
    'snapshot',
  );
  assert.deepEqual(
    await f.manager.collectDelivery(
      a.operationId,
      { writePaths: ['allowed.txt'] },
      'delivery:scope',
    ),
    delivery,
  );
  const candidate = await f.manager.prepareIntegration(
    {
      targetRef: 'refs/heads/crew-scope',
      expectedBase: a.baseRevision!,
      deliveryOperationIds: [delivery.operationId],
      checks: check(
        "require('node:assert/strict').equal(require('node:fs').readFileSync('allowed.txt','utf8'),'snapshot')",
      ),
    },
    'prepare:scope',
  );
  const promotion = await f.manager.promoteIntegration(
    candidate.operationId,
    'promote:scope',
  );
  f.store.observeAttempt(
    f.actor,
    a.attemptId,
    { status: 'exited', pid: null, exit_code: 0 },
    'attempt:scope-stopped',
    f.version(),
  );
  await assert.rejects(
    f.manager.cleanupWorkspace(
      a.operationId,
      delivery.operationId,
      promotion.operationId,
      'cleanup:later',
    ),
    code('UNPRESERVED_CHANGES'),
  );
  assert.equal(readFileSync(join(a.path, 'allowed.txt'), 'utf8'), 'later work');
});

test('merge conflicts preserve both sources and a candidate worktree for a resolution task', async (t) => {
  const f = fixture(t),
    deliveries: string[] = [];
  let base = '';
  for (const [index, value] of [
    'first intent\n',
    'second intent\n',
  ].entries()) {
    const workspace = await f.manager.createWorkspace(
      { ...f.task(), mode: 'code' },
      `workspace:conflict${index}`,
    );
    base = workspace.baseRevision!;
    writeFileSync(join(workspace.path, 'base.txt'), value);
    const delivery = await f.manager.collectDelivery(
      workspace.operationId,
      { writePaths: ['**'] },
      `delivery:conflict${index}`,
    );
    deliveries.push(delivery.operationId);
    assert.equal(
      git(f.root, 'show', `${delivery.sourceRevision.slice(4)}:base.txt`),
      value.trimEnd(),
    );
  }
  const candidate = await f.manager.prepareIntegration(
    {
      targetRef: 'refs/heads/crew-conflict',
      expectedBase: base,
      deliveryOperationIds: deliveries,
      checks: check('process.exit(0)'),
    },
    'prepare:conflict',
  );
  assert.equal(candidate.status, 'conflict');
  assert.deepEqual(candidate.conflicts, ['base.txt']);
  assert.ok(
    readFileSync(join(candidate.path, 'base.txt'), 'utf8').includes('<<<<<<<'),
  );
  assert.equal(git(f.root, 'rev-parse', candidate.targetRef), base.slice(4));
  await assert.rejects(
    f.manager.promoteIntegration(candidate.operationId, 'promote:conflict'),
    code('UNVERIFIED_CANDIDATE'),
  );
});

test('two isolated passing changes can fail their combination without advancing stable', async (t) => {
  const f = fixture(t),
    deliveries: string[] = [];
  const command =
    "const fs=require('node:fs');if(fs.existsSync('a.txt')&&fs.existsSync('b.txt'))process.exit(1)";
  let base = '';
  for (const file of ['a.txt', 'b.txt']) {
    const workspace = await f.manager.createWorkspace(
      { ...f.task(), mode: 'code' },
      `workspace:${file}`,
    );
    base = workspace.baseRevision!;
    writeFileSync(join(workspace.path, file), 'valid alone');
    execFileSync(process.execPath, ['-e', command], { cwd: workspace.path });
    const delivery = await f.manager.collectDelivery(
      workspace.operationId,
      { writePaths: ['**'] },
      `delivery:${file}`,
    );
    deliveries.push(delivery.operationId);
  }
  const candidate = await f.manager.prepareIntegration(
    {
      targetRef: 'refs/heads/crew-failed',
      expectedBase: base,
      deliveryOperationIds: deliveries,
      checks: check(command),
    },
    'prepare:failed',
  );
  assert.equal(candidate.status, 'validation_failed');
  assert.equal(candidate.proofs[0]!.exitCode, 1);
  assert.equal(git(f.root, 'rev-parse', candidate.targetRef), base.slice(4));
  await assert.rejects(
    f.manager.promoteIntegration(candidate.operationId, 'promote:failed'),
    code('UNVERIFIED_CANDIDATE'),
  );
});

test('external ref advancement and a checked-out target are refused without changing user work', async (t) => {
  const f = fixture(t),
    workspace = await f.manager.createWorkspace(
      { ...f.task(), mode: 'code' },
      'workspace:external',
    );
  writeFileSync(join(workspace.path, 'a.txt'), 'a');
  const delivery = await f.manager.collectDelivery(
    workspace.operationId,
    { writePaths: ['**'] },
    'delivery:external',
  );
  const request = {
    targetRef: 'refs/heads/crew-external',
    expectedBase: workspace.baseRevision!,
    deliveryOperationIds: [delivery.operationId],
    checks: check('process.exit(0)'),
  };
  const candidate = await f.manager.prepareIntegration(
    request,
    'prepare:external',
  );
  const tree = git(
    f.root,
    'rev-parse',
    `${workspace.baseRevision!.slice(4)}^{tree}`,
  );
  const external = git(
    f.root,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@localhost',
    'commit-tree',
    tree,
    '-p',
    workspace.baseRevision!.slice(4),
    '-m',
    'external update',
  );
  git(
    f.root,
    'update-ref',
    request.targetRef,
    external,
    workspace.baseRevision!.slice(4),
  );
  await assert.rejects(
    f.manager.promoteIntegration(candidate.operationId, 'promote:external'),
    code('TARGET_ADVANCED'),
  );
  assert.equal(git(f.root, 'rev-parse', request.targetRef), external);
  const checkedOut = await f.manager.prepareIntegration(
    { ...request, targetRef: 'refs/heads/main' },
    'prepare:checked',
  );
  await assert.rejects(
    f.manager.promoteIntegration(checkedOut.operationId, 'promote:checked'),
    code('TARGET_CHECKED_OUT'),
  );
  assert.equal(
    git(f.root, 'rev-parse', 'main'),
    workspace.baseRevision!.slice(4),
  );
});

test('restart reconciles a Git promotion whose database outcome was not yet recorded', async (t) => {
  const f = fixture(t),
    workspace = await f.manager.createWorkspace(
      { ...f.task(), mode: 'code' },
      'workspace:restart',
    );
  writeFileSync(join(workspace.path, 'a.txt'), 'a');
  const delivery = await f.manager.collectDelivery(
    workspace.operationId,
    { writePaths: ['**'] },
    'delivery:restart',
  );
  const candidate = await f.manager.prepareIntegration(
    {
      targetRef: 'refs/heads/crew-restart',
      expectedBase: workspace.baseRevision!,
      deliveryOperationIds: [delivery.operationId],
      checks: check('process.exit(0)'),
    },
    'prepare:restart',
  );
  const key = 'promote:restart';
  const operation = f.store.beginOperation(
    f.actor,
    'integration.promote',
    JSON.stringify({ preparationOperationId: candidate.operationId }),
    key,
    f.version(),
  );
  git(
    f.root,
    'update-ref',
    candidate.targetRef,
    candidate.candidateRevision.slice(4),
    candidate.expectedBase.slice(4),
  );
  const restarted = new WorkspaceManager(f.reopen(), f.actor);
  const promotion = await restarted.promoteIntegration(
    candidate.operationId,
    key,
  );
  assert.equal(promotion.operationId, operation.id);
  assert.equal(promotion.revision, candidate.candidateRevision);
  f.store.observeAttempt(
    f.actor,
    workspace.attemptId,
    { status: 'exited', pid: null, exit_code: 0 },
    'attempt:restart-stopped',
    f.version(),
  );
  const cleanupKey = 'cleanup:restart';
  f.store.beginOperation(
    f.actor,
    'workspace.cleanup',
    JSON.stringify({
      workspaceOperationId: workspace.operationId,
      deliveryOperationId: delivery.operationId,
      promotionOperationId: promotion.operationId,
    }),
    cleanupKey,
    f.version(),
  );
  git(f.root, 'worktree', 'remove', '--force', workspace.path);
  const cleanupRestarted = new WorkspaceManager(f.reopen(), f.actor);
  const cleaned = await cleanupRestarted.cleanupWorkspace(
    workspace.operationId,
    delivery.operationId,
    promotion.operationId,
    cleanupKey,
  );
  assert.equal(cleaned.path, workspace.path);
  assert.deepEqual(
    await cleanupRestarted.cleanupWorkspace(
      workspace.operationId,
      delivery.operationId,
      promotion.operationId,
      cleanupKey,
    ),
    cleaned,
  );
  assert.equal(
    git(f.root, 'rev-parse', delivery.preservationRef!),
    delivery.sourceRevision.slice(4),
  );
});

test('clean accepted workspaces are removed explicitly while ignored files prevent data loss', async (t) => {
  const f = fixture(t),
    workspace = await f.manager.createWorkspace(
      { ...f.task(), mode: 'code' },
      'workspace:cleanup',
    );
  writeFileSync(join(workspace.path, 'a.txt'), 'a');
  const delivery = await f.manager.collectDelivery(
    workspace.operationId,
    { writePaths: ['**'] },
    'delivery:cleanup',
  );
  const candidate = await f.manager.prepareIntegration(
    {
      targetRef: 'refs/heads/crew-cleanup',
      expectedBase: workspace.baseRevision!,
      deliveryOperationIds: [delivery.operationId],
      checks: check('process.exit(0)'),
    },
    'prepare:cleanup',
  );
  const promotion = await f.manager.promoteIntegration(
    candidate.operationId,
    'promote:cleanup',
  );
  await assert.rejects(
    f.manager.cleanupWorkspace(
      workspace.operationId,
      delivery.operationId,
      promotion.operationId,
      'cleanup:active',
    ),
    code('ACTIVE_WORKSPACE'),
  );
  assert.equal(existsSync(workspace.path), true);
  f.store.observeAttempt(
    f.actor,
    workspace.attemptId,
    { status: 'exited', pid: null, exit_code: 0 },
    'attempt:cleanup-stopped',
    f.version(),
  );
  writeFileSync(join(f.root, '.git', 'info', 'exclude'), 'generated.log\n');
  writeFileSync(join(workspace.path, 'generated.log'), 'unsubmitted evidence');
  await assert.rejects(
    f.manager.cleanupWorkspace(
      workspace.operationId,
      delivery.operationId,
      promotion.operationId,
      'cleanup:blocked',
    ),
    code('UNPRESERVED_CHANGES'),
  );
  rmSync(join(workspace.path, 'generated.log'));
  await f.manager.cleanupWorkspace(
    workspace.operationId,
    delivery.operationId,
    promotion.operationId,
    'cleanup:accepted',
  );
  assert.equal(existsSync(workspace.path), false);
  assert.equal(
    git(f.root, 'rev-parse', delivery.preservationRef!),
    delivery.sourceRevision.slice(4),
  );
});

test('document snapshots reject traversal and symlink ancestors that escape the assigned scope', async (t) => {
  const f = fixture(t, false);
  mkdirSync(join(f.root, 'docs'));
  mkdirSync(join(f.root, 'private'));
  writeFileSync(join(f.root, 'private.txt'), 'outside assigned scope');
  writeFileSync(
    join(f.root, 'private', 'note.txt'),
    'outside assigned scope through alias',
  );
  symlinkSync(join(f.root, 'private'), join(f.root, 'docs', 'alias'));
  const workspace = await f.manager.createWorkspace(
    { ...f.task(['docs']), mode: 'documentation' },
    'workspace:scope-doc',
  );
  for (const [index, path] of [
    'docs/../private.txt',
    'docs/alias/note.txt',
  ].entries()) {
    await assert.rejects(
      f.manager.collectDelivery(
        workspace.operationId,
        { writePaths: ['docs'], documentPaths: [path] },
        `delivery:escape-doc-${index}`,
      ),
    );
  }
});

test(
  'a timed out command kills surviving process-group descendants before returning',
  { skip: process.platform === 'win32' },
  async (t) => {
    const directory = mkdtempSync(
      join(tmpdir(), 'avity crew process cleanup '),
    );
    const heartbeat = join(directory, 'heartbeat'),
      pidFile = join(directory, 'pid');
    t.after(() => {
      if (existsSync(pidFile)) {
        try {
          process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL');
        } catch {
          /* Already terminated. */
        }
      }
      rmSync(directory, { recursive: true, force: true });
    });
    const grandchild = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'.'),25);`;
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
    const result = await runCommand(
      directory,
      [process.execPath, '-e', parent],
      1000,
    );
    assert.match(result.error ?? '', /exceeded/);
    assert.ok(existsSync(heartbeat), 'descendant was observed running');
    const observed = readFileSync(heartbeat, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 750));
    assert.equal(
      readFileSync(heartbeat, 'utf8'),
      observed,
      'no descendant writes after command completion',
    );
  },
);

test('documentary snapshots and read-only work do not initialize Git or remove the user directory', async (t) => {
  const f = fixture(t, false),
    request = f.task();
  const workspace = await f.manager.createWorkspace(
    { ...request, mode: 'documentation' },
    'workspace:document',
  );
  writeFileSync(join(f.root, 'result.txt'), 'first document');
  const delivery = await f.manager.collectDelivery(
    workspace.operationId,
    { writePaths: ['**'], documentPaths: ['result.txt'] },
    'delivery:document',
  );
  writeFileSync(join(f.root, 'result.txt'), 'later document');
  assert.equal(
    f.store.readArtifact(delivery.documents[0]!).toString(),
    'first document',
  );
  assert.equal(delivery.baseRevision, null);
  assert.equal((await inspectRepository(f.root)).commonDir, null);
  const reader = await f.manager.createWorkspace(
    { ...f.task(), mode: 'read-only' },
    'workspace:reader',
  );
  assert.equal(reader.path, f.project.root);
  await assert.rejects(
    f.manager.collectDelivery(
      reader.operationId,
      { writePaths: ['**'] },
      'delivery:reader',
    ),
    code('READ_ONLY_WORKSPACE'),
  );
  await assert.rejects(
    f.manager.cleanupWorkspace(
      workspace.operationId,
      'missing',
      'missing',
      'cleanup:document',
    ),
    code('USER_DIRECTORY'),
  );
  assert.equal(existsSync(f.root), true);
});

test('Git initialization needs explicit authorization and its empty baseline does not commit user files', async (t) => {
  const f = fixture(t, false);
  await assert.rejects(
    f.manager.initializeRepository(
      { authorized: false } as never,
      'init:denied',
    ),
    code('INITIALIZATION_NOT_AUTHORIZED'),
  );
  assert.equal(existsSync(join(f.root, '.git')), false);
  const state = await f.manager.initializeRepository(
    { authorized: true, createEmptyBaseline: true },
    'init:authorized',
  );
  assert.ok(state.head);
  assert.equal(git(f.root, 'ls-tree', '-r', '--name-only', 'HEAD'), '');
  assert.equal(readFileSync(join(f.root, 'base.txt'), 'utf8'), 'baseline\n');
  assert.equal(
    identifyProject(f.root, join(f.directory, 'data')).id,
    f.project.id,
  );
});

test('ports remain actually reserved and temporary databases are distinct until release', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'avity resources '));
  const a = await reserveResources(directory),
    b = await reserveResources(directory);
  t.after(async () => {
    await a.release();
    await b.release();
    rmSync(directory, { recursive: true, force: true });
  });
  assert.notEqual(a.ports[0], b.ports[0]);
  assert.notEqual(a.databasePath, b.databasePath);
  for (const lease of [a, b]) {
    const db = new DatabaseSync(lease.databasePath);
    db.exec('CREATE TABLE isolated (id INTEGER)');
    db.close();
  }
  const blocked = createServer();
  await assert.rejects(
    new Promise<void>((resolve, reject) => {
      blocked.once('error', reject);
      blocked.listen(a.ports[0], '127.0.0.1', resolve);
    }),
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'EADDRINUSE',
  );
  await a.release();
  assert.ok(existsSync(a.databasePath));
});

test('resource assignments persist with their workspace and named resources have one owner', async (t) => {
  const f = fixture(t);
  const lease = await f.manager.reserveResources(1, ['migration:project']);
  t.after(() => lease.release());
  await assert.rejects(
    f.manager.reserveResources(0, ['migration:project']),
    code('RESOURCE_BUSY'),
  );
  const workspace = await f.manager.createWorkspace(
    { ...f.task(), mode: 'code', resources: lease },
    'workspace:assigned',
  );
  const recorded = f.store.getRecord<{
    ports: number[];
    temporary_dir: string;
  }>(f.run.id, 'workspace', workspace.id);
  assert.deepEqual(recorded.ports, lease.ports);
  assert.equal(recorded.temporary_dir, lease.temporaryDirectory);
  assert.equal(workspace.databasePath, lease.databasePath);
  await lease.release();
  const next = await f.manager.reserveResources(0, ['migration:project']);
  await next.release();
});

test('one integration writer is enforced across manager instances', async (t) => {
  const f = fixture(t),
    workspace = await f.manager.createWorkspace(
      { ...f.task(), mode: 'code' },
      'workspace:lock',
    );
  writeFileSync(join(workspace.path, 'a.txt'), 'a');
  const delivery = await f.manager.collectDelivery(
    workspace.operationId,
    { writePaths: ['**'] },
    'delivery:lock',
  );
  const ready = join(f.directory, 'check-ready');
  const waiting = new Promise<void>((resolve) => {
    const watcher = watch(f.directory, () => {
      if (existsSync(ready)) {
        watcher.close();
        resolve();
      }
    });
    t.after(() => watcher.close());
  });
  const request = {
    targetRef: 'refs/heads/crew-lock',
    expectedBase: workspace.baseRevision!,
    deliveryOperationIds: [delivery.operationId],
    checks: check(
      `require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setTimeout(()=>{},200)`,
    ),
  };
  await assert.rejects(
    f.manager.prepareIntegration(request, ''),
    code('INVALID_INPUT'),
  );
  assert.equal(existsSync(join(f.project.data_dir, 'integration.lock')), false);
  const first = f.manager.prepareIntegration(request, 'prepare:lock');
  await waiting;
  const second = new WorkspaceManager(f.store, f.actor);
  await assert.rejects(
    second.prepareIntegration(request, 'prepare:other'),
    code('INTEGRATION_BUSY'),
  );
  assert.equal((await first).status, 'validated');
});

test(
  'a killed integration writer leaves its candidate intact and requires reconciliation before replay',
  { timeout: 10_000, skip: process.platform === 'win32' },
  async (t) => {
    const f = fixture(t),
      workspace = await f.manager.createWorkspace(
        { ...f.task(), mode: 'code' },
        'workspace:kill',
      );
    writeFileSync(join(workspace.path, 'a.txt'), 'preserved intent');
    const delivery = await f.manager.collectDelivery(
      workspace.operationId,
      { writePaths: ['**'] },
      'delivery:kill',
    );
    const ready = join(f.directory, 'writer-ready');
    const request = {
      targetRef: 'refs/heads/crew-killed',
      expectedBase: workspace.baseRevision!,
      deliveryOperationIds: [delivery.operationId],
      checks: check(
        `require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`,
      ),
    };
    let watcher: ReturnType<typeof watch>;
    const observed = new Promise<void>((resolve) => {
      watcher = watch(f.directory, () => {
        if (
          existsSync(ready) &&
          /^[1-9][0-9]*$/.test(readFileSync(ready, 'utf8'))
        ) {
          watcher.close();
          resolve();
        }
      });
    });
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL('./fixtures/workspace-worker.js', import.meta.url),
        ),
        JSON.stringify({
          project: f.project,
          actor: f.actor,
          request,
          key: 'prepare:kill',
        }),
      ],
      { stdio: 'ignore' },
    );
    const exited = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', () => resolve());
    });
    let checkPid: number | undefined;
    t.after(() => {
      watcher.close();
      if (child.exitCode === null && child.signalCode === null)
        child.kill('SIGKILL');
      if (checkPid) {
        try {
          process.kill(-checkPid, 'SIGKILL');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      }
    });
    await Promise.race([
      observed,
      exited.then(() => {
        throw new Error('Integration writer exited before the check barrier');
      }),
    ]);
    checkPid = Number(readFileSync(ready, 'utf8'));
    assert.ok(
      Number.isSafeInteger(checkPid) &&
        checkPid > 1 &&
        checkPid !== process.pid &&
        checkPid !== child.pid,
    );
    child.kill('SIGKILL');
    await exited;
    process.kill(-checkPid, 'SIGKILL');
    checkPid = undefined;
    assert.equal(
      git(f.root, 'rev-parse', request.targetRef),
      request.expectedBase.slice(4),
    );
    f.manager.recoverIntegrationLock();
    await assert.rejects(
      f.manager.prepareIntegration(request, 'prepare:kill'),
      (error: unknown) => {
        if (
          !(error instanceof CrewError) ||
          error.code !== 'RECONCILIATION_REQUIRED'
        )
          return false;
        const details = error.details as { path: string };
        assert.equal(
          readFileSync(join(details.path, 'a.txt'), 'utf8'),
          'preserved intent',
        );
        return true;
      },
    );
    assert.equal(
      git(f.root, 'show', `${delivery.sourceRevision.slice(4)}:a.txt`),
      'preserved intent',
    );
  },
);
