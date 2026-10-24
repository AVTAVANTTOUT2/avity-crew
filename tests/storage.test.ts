import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Store, identifyProject } from '../packages/storage/src/index.ts';
import { CrewError, now } from '../packages/contracts/src/index.ts';
import type {
  Run,
  Actor,
  AgentSession,
  TaskSpec,
  Handoff,
  Decision,
  Message,
} from '../packages/contracts/src/index.ts';

const example = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../tests/fixtures/contracts/${name}.example.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
const code =
  (expected: string) =>
  (error: unknown): boolean =>
    error instanceof CrewError && error.code === expected;

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'avity crew storage '));
  const root = join(directory, 'project');
  mkdirSync(root);
  const project = identifyProject(root, join(directory, 'data'));
  const store = new Store(project);
  t.after(() => {
    try {
      store.close();
    } catch {
      /* Test may already have closed it for recovery. */
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const run: Run = {
    id: 'run:test',
    project_id: project.id,
    objective: 'Document a deterministic local fixture',
    constraints: [],
    acceptance_criteria: [
      {
        id: 'criterion:run',
        description: 'Evidence retained',
        required: true,
        verification: 'local tests',
      },
    ],
    delivery_mode: 'documentation',
    status: 'planning',
    chief_provider: 'codex',
    chief_model: null,
    generation: 1,
    version: 0,
    max_active_agents: 7,
    created_at: now(),
    updated_at: now(),
  };
  store.createRun(run, 'create:run');
  const actor: Actor = {
    id: 'user:local',
    project_id: project.id,
    run_id: run.id,
    role: 'user',
    task_id: null,
    attempt_id: null,
    generation: 1,
  };
  const task: TaskSpec = {
    ...(example('task') as TaskSpec),
    id: 'task:test',
    run_id: run.id,
    base_revision: null,
    depends_on: [],
  };
  const version = () => store.getRun(run.id).version;
  const addTask = () => store.createTask(actor, task, 'create:task', version());
  const session = (id = 'session:test'): AgentSession => ({
    id,
    run_id: run.id,
    task_id: task.id,
    provider: 'codex',
    model: null,
    native_session_id: null,
    cli_version: null,
    cwd: root,
    capabilities: null,
  });
  return {
    directory,
    root,
    project,
    store,
    run,
    actor,
    task,
    version,
    addTask,
    session,
  };
}

test('SQLite persists documentary tasks, decisions, message observations and a delivery', (t) => {
  const f = fixture(t);
  f.addTask();
  const attempt = f.store.claimTask(
    f.actor,
    f.task.id,
    f.session(),
    'claim:task',
    f.version(),
  );
  f.store.observeAttempt(
    f.actor,
    attempt.id,
    { status: 'running', pid: 123, exit_code: null },
    'start:attempt',
    f.version(),
  );
  const worker: Actor = {
    ...f.actor,
    id: attempt.session_id,
    role: 'developer',
    task_id: attempt.task_id,
    attempt_id: attempt.id,
    generation: attempt.generation,
  };
  const handoff: Handoff = {
    ...(example('handoff') as Handoff),
    id: 'handoff:test',
    task_id: f.task.id,
    run_id: f.run.id,
    attempt_id: attempt.id,
    generation: attempt.generation,
    source_revision: null,
    status: 'delivered',
  };
  handoff.artifacts = handoff.artifacts.map((artifact) => ({
    ...artifact,
    producer_attempt_id: attempt.id,
  }));
  f.store.submitHandoff(worker, handoff, 'submit:handoff', f.version());
  assert.equal(f.store.getTask(f.task.id).status, 'in_review');
  assert.equal(f.store.getRun(f.run.id).status, 'planning');
  const decision: Decision = {
    schema_version: 1,
    id: 'decision:test',
    run_id: f.run.id,
    question: 'Format?',
    answer: 'Markdown',
    status: 'approved',
    approved_by: f.actor.id,
    source_ids: [],
    affects_task_ids: [f.task.id],
    supersedes: null,
    created_at: now(),
  };
  f.store.recordDecision(f.actor, decision, 'record:decision', f.version());
  const message: Message = {
    id: 'message:test',
    run_id: f.run.id,
    sender_id: f.actor.id,
    recipient_kind: 'task',
    recipient_id: f.task.id,
    kind: 'information',
    content: 'Use the approved format; token=fixture-sensitive-value',
    source_ids: [],
    status: 'queued',
    created_at: now(),
  };
  f.store.sendMessage(f.actor, message, 'send:message', f.version());
  f.store.updateMessage(
    f.actor,
    message.id,
    'delivered',
    'message:delivered',
    f.version(),
  );
  assert.equal(
    f.store.getRecord<Message>(f.run.id, 'message', message.id).status,
    'delivered',
  );
  assert.throws(
    () =>
      f.store.updateMessage(
        f.actor,
        message.id,
        'applied',
        'message:skip',
        f.version(),
      ),
    code('INVALID_TRANSITION'),
  );
  f.store.close();
  const reopened = new Store(f.project);
  t.after(() => reopened.close());
  assert.equal(reopened.getTask(f.task.id).active_attempt_id, attempt.id);
  assert.equal(
    reopened.getRecord<Decision>(f.run.id, 'decision', decision.id).approved_by,
    f.actor.id,
  );
  assert.equal(
    reopened.getRecord<Handoff>(f.run.id, 'handoff', handoff.id).attempt_id,
    attempt.id,
  );
  assert.doesNotMatch(
    reopened.getRecord<Message>(f.run.id, 'message', message.id).content,
    /fixture-sensitive-value/,
  );
});

test('idempotent creation and claim replay preserve their identity and event count', (t) => {
  const f = fixture(t);
  f.addTask();
  assert.deepEqual(f.store.createRun(f.run, 'create:run'), f.run);
  const version = f.version(),
    session = f.session();
  const first = f.store.claimTask(
    f.actor,
    f.task.id,
    session,
    'claim:task',
    version,
  );
  const events = f.store.events(f.run.id).length;
  assert.deepEqual(
    f.store.claimTask(f.actor, f.task.id, session, 'claim:task', version),
    first,
  );
  assert.equal(f.store.events(f.run.id).length, events);
  assert.equal(f.store.attempts(f.run.id).length, 1);
  assert.throws(
    () =>
      f.store.claimTask(
        f.actor,
        f.task.id,
        f.session('session:other'),
        'claim:task',
        version,
      ),
    code('IDEMPOTENCY_CONFLICT'),
  );
  assert.throws(
    () =>
      f.store.claimTask(
        { ...f.actor, project_id: 'project:other' },
        f.task.id,
        session,
        'claim:task',
        version,
      ),
    code('FORBIDDEN'),
  );
});

function child(input: object, t: TestContext) {
  const process = spawn(
    globalThis.process.execPath,
    [
      fileURLToPath(new URL('./fixtures/storage-worker.js', import.meta.url)),
      JSON.stringify(input),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  t.after(() => {
    if (process.exitCode === null) process.kill('SIGKILL');
  });
  let output = '',
    errors = '';
  const waiters: { text: string; resolve: () => void }[] = [];
  process.stdout.on('data', (chunk) => {
    output += chunk.toString();
    if (output.length > 16384) process.kill('SIGKILL');
    for (const waiter of waiters)
      if (output.includes(waiter.text)) waiter.resolve();
  });
  process.stderr.on('data', (chunk) => {
    errors = (errors + chunk.toString()).slice(-8192);
  });
  const finished = new Promise<number | null>((resolve, reject) => {
    process.once('error', reject);
    process.once('exit', (exit) => resolve(exit));
  });
  async function waitFor(text: string): Promise<void> {
    if (output.includes(text)) return;
    await Promise.race([
      new Promise<void>((resolve) => waiters.push({ text, resolve })),
      finished.then(() => {
        if (!output.includes(text))
          throw new Error(`Worker exited before ${text}: ${errors}`);
      }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Worker deadline exceeded')),
          10000,
        );
        timer.unref();
      }),
    ]);
  }
  return { process, finished, waitFor, output: () => output };
}

test(
  'two independent processes racing a claim create exactly one authorized attempt',
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t);
    f.addTask();
    const version = f.version();
    const workers = [1, 2].map((index) =>
      child(
        {
          project: f.project,
          actor: f.actor,
          session: f.session(`session:${index}`),
          key: `claim:${index}`,
          version,
          action: 'claim',
        },
        t,
      ),
    );
    await Promise.all(workers.map((worker) => worker.waitFor('READY')));
    for (const worker of workers) worker.process.stdin.end('GO');
    const exits = await Promise.all(workers.map((worker) => worker.finished));
    assert.deepEqual(exits.sort(), [0, 1]);
    assert.equal(f.store.attempts(f.run.id).length, 1);
    assert.equal(f.store.getTask(f.task.id).status, 'running');
  },
);

test('heartbeat expiry does not release ownership, and a late previous attempt is rejected', (t) => {
  const f = fixture(t);
  f.addTask();
  const first = f.store.claimTask(
    f.actor,
    f.task.id,
    f.session(),
    'claim:first',
    f.version(),
  );
  assert.equal(f.store.overdueAttempts(f.run.id, '9999-01-01').length, 1);
  assert.throws(
    () =>
      f.store.reassignTask(f.actor, f.task.id, 'reassign:alive', f.version()),
    code('RECONCILIATION_REQUIRED'),
  );
  f.store.observeAttempt(
    f.actor,
    first.id,
    { status: 'interrupted', pid: null, exit_code: null },
    'stop:first',
    f.version(),
  );
  f.store.reassignTask(f.actor, f.task.id, 'reassign:stopped', f.version());
  const second = f.store.claimTask(
    f.actor,
    f.task.id,
    f.session('session:second'),
    'claim:second',
    f.version(),
  );
  assert.ok(second.generation > first.generation);
  const worker: Actor = {
    ...f.actor,
    id: first.session_id,
    role: 'developer',
    task_id: first.task_id,
    attempt_id: first.id,
    generation: first.generation,
  };
  const stale: Handoff = {
    ...(example('handoff') as Handoff),
    task_id: first.task_id,
    run_id: first.run_id,
    attempt_id: first.id,
    generation: first.generation,
  };
  assert.throws(
    () => f.store.submitHandoff(worker, stale, 'submit:stale', f.version()),
    code('STALE_ATTEMPT'),
  );
  assert.equal(f.store.getTask(f.task.id).active_attempt_id, second.id);
});

test('a failed event insert rolls back domain mutation, version and idempotency key together', (t) => {
  const f = fixture(t),
    direct = new DatabaseSync(f.store.filename);
  t.after(() => direct.close());
  direct.exec(
    "CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'injected event failure'); END;",
  );
  assert.throws(() => f.addTask(), /injected event failure/);
  assert.equal(f.store.tasks(f.run.id).length, 0);
  assert.equal(f.version(), 0);
  assert.equal(f.store.events(f.run.id).length, 1);
  direct.exec('DROP TRIGGER fail_event;');
  assert.equal(f.addTask().id, f.task.id);
});

test('dependency failure cannot start a task and rejected graphs leave no partial task', (t) => {
  const f = fixture(t);
  f.addTask();
  const dependent = {
    ...f.task,
    id: 'task:dependent',
    depends_on: [f.task.id],
  };
  f.store.createTask(f.actor, dependent, 'create:dependent', f.version());
  assert.throws(
    () =>
      f.store.claimTask(
        f.actor,
        dependent.id,
        { ...f.session(), task_id: dependent.id },
        'claim:dependent',
        f.version(),
      ),
    code('TASK_NOT_READY'),
  );
  assert.throws(
    () =>
      f.store.createTask(
        f.actor,
        { ...f.task, id: 'task:cycle', depends_on: ['task:cycle'] },
        'create:cycle',
        f.version(),
      ),
    code('DEPENDENCY_CYCLE'),
  );
  assert.equal(f.store.tasks(f.run.id).length, 2);
});

test('migration from the previous version preserves data and rejects future databases', (t) => {
  const f = fixture(t);
  f.addTask();
  f.store.close();
  const previous = new DatabaseSync(f.store.filename);
  previous.exec(
    'DROP INDEX one_active_attempt; DROP INDEX tasks_by_run; DROP INDEX records_by_task; PRAGMA user_version=1;',
  );
  previous.close();
  const migrated = new Store(f.project);
  assert.equal(migrated.getTask(f.task.id).spec.base_revision, null);
  migrated.close();
  const direct = new DatabaseSync(f.store.filename);
  direct.exec('PRAGMA user_version=99;');
  direct.close();
  assert.throws(() => new Store(f.project), code('INCOMPATIBLE_DATABASE'));
  const preserved = new DatabaseSync(f.store.filename);
  t.after(() => preserved.close());
  assert.equal(
    preserved.prepare('PRAGMA user_version').get()?.['user_version'],
    99,
  );
  assert.equal(
    preserved.prepare('SELECT count(*) AS count FROM tasks').get()?.['count'],
    1,
  );
});

test(
  'abrupt termination rolls back an uncommitted migration and preserves uncertain external intent',
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t);
    const operation = f.store.beginOperation(
      f.actor,
      'spawn',
      'fixture-only',
      'operation:intent',
      f.version(),
    );
    const worker = child(
      {
        project: f.project,
        actor: f.actor,
        session: f.session(),
        key: 'unused:key',
        version: f.version(),
        action: 'crash',
      },
      t,
    );
    await worker.waitFor('READY');
    worker.process.stdin.write('GO');
    await worker.waitFor('UNCOMMITTED');
    worker.process.kill('SIGKILL');
    await worker.finished;
    f.store.close();
    const reopened = new Store(f.project);
    t.after(() => reopened.close());
    assert.equal(reopened.uncertainOperations(f.run.id)[0]?.id, operation.id);
    assert.equal(reopened.uncertainOperations(f.run.id)[0]?.status, 'intent');
    const direct = new DatabaseSync(reopened.filename);
    t.after(() => direct.close());
    assert.equal(
      direct
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE name='interrupted_migration'",
        )
        .get()?.['count'],
      0,
    );
  },
);

test('event pages have stable cursors and the online backup reopens coherently', async (t) => {
  const f = fixture(t);
  for (let index = 0; index < 140; index++)
    f.store.beginOperation(
      f.actor,
      'test',
      `target:${index}`,
      `operation:${index}`,
      f.version(),
    );
  let after = 0,
    total = 0;
  while (true) {
    const page = f.store.events(f.run.id, after, 17);
    if (!page.length) break;
    for (const event of page) assert.equal(event.seq, ++after);
    total += page.length;
  }
  assert.equal(total, 141);
  assert.throws(() => f.store.events(f.run.id, 0, 1001), code('INVALID_LIMIT'));
  const directory = join(f.directory, 'backup');
  mkdirSync(directory);
  const artifact = f.store.writeArtifact('immutable backup evidence');
  await f.store.backup(join(directory, 'state.sqlite'));
  const restored = new Store({ ...f.project, data_dir: directory });
  t.after(() => restored.close());
  assert.equal(restored.events(f.run.id, 0, 1000).length, 141);
  assert.equal(restored.project.data_dir, directory);
  assert.equal(
    restored.readArtifact(artifact).toString(),
    'immutable backup evidence',
  );
  await assert.rejects(
    f.store.backup(join(directory, 'state.sqlite')),
    code('ALREADY_EXISTS'),
  );
});

test(
  'concurrent first openings migrate and identify the same empty database atomically',
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t),
      project = { ...f.project, data_dir: join(f.directory, 'fresh database') };
    const workers = [1, 2].map((index) =>
      child(
        {
          project,
          actor: f.actor,
          session: f.session(`session:init${index}`),
          key: `init:${index}`,
          version: 0,
          action: 'init',
        },
        t,
      ),
    );
    await Promise.all(workers.map((worker) => worker.waitFor('READY')));
    for (const worker of workers) worker.process.stdin.end('GO');
    assert.deepEqual(
      await Promise.all(workers.map((worker) => worker.finished)),
      [0, 0],
    );
    const store = new Store(project);
    t.after(() => store.close());
    assert.equal(store.project.id, project.id);
  },
);

test('decisions retain supersession provenance, failed messages stay explicit and workers cannot forge authority', (t) => {
  const f = fixture(t);
  f.addTask();
  const first: Decision = {
    schema_version: 1,
    id: 'decision:first',
    run_id: f.run.id,
    question: 'Format?',
    answer: 'Plain text',
    status: 'approved',
    approved_by: f.actor.id,
    source_ids: ['source:user'],
    affects_task_ids: [f.task.id],
    supersedes: null,
    created_at: now(),
  };
  f.store.recordDecision(f.actor, first, 'decision:first', f.version());
  const second = {
    ...first,
    id: 'decision:second',
    answer: 'Markdown',
    supersedes: first.id,
  };
  f.store.recordDecision(f.actor, second, 'decision:second', f.version());
  assert.equal(
    f.store.getRecord<Decision>(f.run.id, 'decision', first.id).status,
    'superseded',
  );
  assert.equal(
    f.store.getRecord<Decision>(f.run.id, 'decision', second.id).supersedes,
    first.id,
  );
  assert.match(f.store.exportMarkdown(f.run.id), /decision:second.*Markdown/);
  const message: Message = {
    id: 'message:failed',
    run_id: f.run.id,
    sender_id: f.actor.id,
    recipient_kind: 'chief',
    recipient_id: `control:${f.run.id}`,
    kind: 'information',
    content: 'A real delivery failed',
    source_ids: [],
    status: 'queued',
    created_at: now(),
  };
  f.store.sendMessage(f.actor, message, 'message:new', f.version());
  f.store.updateMessage(
    f.actor,
    message.id,
    'failed',
    'message:failed',
    f.version(),
  );
  assert.throws(
    () =>
      f.store.updateMessage(
        f.actor,
        message.id,
        'delivered',
        'message:revive',
        f.version(),
      ),
    code('INVALID_TRANSITION'),
  );
  assert.throws(
    () =>
      f.store.createTask(
        { ...f.actor, role: 'developer' },
        { ...f.task, id: 'task:forged' },
        'task:forged',
        f.version(),
      ),
    code('FORBIDDEN'),
  );
  assert.throws(
    () =>
      f.store.updateRunStatus(f.actor, 'completed', 'run:forged', f.version()),
    code('EVIDENCE_REQUIRED'),
  );
});

test('private artifacts verify hashes, redact logs and reject traversal or symlink escapes', (t) => {
  const f = fixture(t);
  const artifact = f.store.writeArtifact(
    'password=fixture-password Bearer abcdefghijklmnop',
    true,
  );
  assert.doesNotMatch(
    f.store.readArtifact(artifact).toString(),
    /fixture-password|abcdefghijklmnop/,
  );
  assert.throws(
    () => f.store.readArtifact({ ...artifact, reference: '../outside' }),
    code('INVALID_ARTIFACT'),
  );
  const external = join(f.directory, 'external');
  writeFileSync(external, 'external data');
  const filename = join(f.project.data_dir, artifact.reference);
  rmSync(filename);
  symlinkSync(external, filename);
  assert.throws(() => f.store.readArtifact(artifact), code('INVALID_ARTIFACT'));
});

test('canonical project identity follows symlinks but isolates distinct projects and databases', (t) => {
  const f = fixture(t),
    alias = join(f.directory, 'alias');
  symlinkSync(f.root, alias);
  assert.equal(
    identifyProject(alias, join(f.directory, 'data')).id,
    f.project.id,
  );
  const otherRoot = join(f.directory, 'other');
  mkdirSync(otherRoot);
  const otherProject = identifyProject(otherRoot, join(f.directory, 'data'));
  assert.notEqual(otherProject.id, f.project.id);
  const other = new Store(otherProject);
  t.after(() => other.close());
  assert.throws(() => other.getRun(f.run.id), code('NOT_FOUND'));
  assert.throws(
    () => new Store({ ...f.project, id: otherProject.id }),
    code('PROJECT_MISMATCH'),
  );
});
