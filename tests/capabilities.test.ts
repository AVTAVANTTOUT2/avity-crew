import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, identifyProject } from '../packages/storage/src/index.ts';
import { CapabilityRegistry } from '../packages/supervisor/src/capabilities.ts';
import { now } from '../packages/contracts/src/index.ts';
import type {
  Actor,
  AgentSession,
  Run,
  TaskSpec,
} from '../packages/contracts/src/index.ts';

test('capabilities are private, survive service recreation and revalidate task authority', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'avity capability ')),
    root = join(directory, 'project');
  mkdirSync(root);
  const store = new Store(identifyProject(root, join(directory, 'data')));
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const run: Run = {
    id: 'run:test',
    project_id: store.project.id,
    objective: 'Test authority',
    constraints: [],
    acceptance_criteria: [
      {
        id: 'criterion:test',
        required: true,
        description: 'No identity spoofing',
        verification: 'test',
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
    project_id: run.project_id,
    run_id: run.id,
    role: 'user',
    task_id: null,
    attempt_id: null,
    generation: 1,
  };
  const spec = JSON.parse(
    readFileSync(
      new URL(
        '../../tests/fixtures/contracts/task.example.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as TaskSpec;
  spec.id = 'task:test';
  spec.run_id = run.id;
  spec.depends_on = [];
  store.createTask(user, spec, 'create:task', 0);
  const session: AgentSession = {
    id: 'session:test',
    run_id: run.id,
    task_id: spec.id,
    provider: 'codex',
    model: null,
    native_session_id: null,
    cli_version: null,
    cwd: root,
    capabilities: null,
  };
  const attempt = store.claimTask(user, spec.id, session, 'claim:task', 1);
  const actor: Actor = {
    id: session.id,
    project_id: run.project_id,
    run_id: run.id,
    role: spec.role,
    task_id: spec.id,
    attempt_id: attempt.id,
    generation: attempt.generation,
  };
  const registry = new CapabilityRegistry(store),
    token = registry.issue(actor);
  const owner = readFileSync(registry.ownerKeyPath, 'utf8');
  assert.deepEqual(registry.authenticate(token), { kind: 'agent', actor });
  assert.deepEqual(registry.authenticate(owner), {
    kind: 'user',
    project_id: run.project_id,
  });
  assert.equal(statSync(registry.ownerKeyPath).mode & 0o077, 0);
  const record = readFileSync(
    join(
      store.project.data_dir,
      'capabilities',
      readdirSync(join(store.project.data_dir, 'capabilities'))[0]!,
    ),
    'utf8',
  );
  assert.ok(!record.includes(token));
  assert.deepEqual(new CapabilityRegistry(store).authenticate(token), {
    kind: 'agent',
    actor,
  });
  assert.throws(
    () => registry.issue({ ...actor, role: 'reviewer' }),
    /authority/,
  );
  assert.throws(
    () => registry.issue({ ...actor, project_id: 'project:other' }),
    /another project/,
  );
  assert.throws(() => registry.authenticate('invalid'), /Invalid capability/);
  store.observeAttempt(
    user,
    attempt.id,
    { status: 'interrupted', pid: null, exit_code: null },
    'stop:attempt',
    store.getRun(run.id).version,
  );
  store.reassignTask(
    user,
    spec.id,
    'reassign:task',
    store.getRun(run.id).version,
  );
  assert.throws(() => registry.authenticate(token), /authority/);
});
