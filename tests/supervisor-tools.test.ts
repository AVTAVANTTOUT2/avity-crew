import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  assertToolAuthority,
  toolsFor,
} from '../packages/supervisor/src/tools.ts';
import { Coordinator } from '../packages/supervisor/src/coordinator.ts';
import { identifyProject, Store } from '../packages/storage/src/index.ts';
import { now } from '../packages/contracts/src/index.ts';
import type {
  Actor,
  CrewEvent,
  Run,
  TaskSpec,
  ToolCall,
} from '../packages/contracts/src/index.ts';

const actor: Actor = {
  id: 'session:a',
  project_id: 'project:a',
  run_id: 'run:a',
  role: 'developer',
  task_id: 'task:a',
  attempt_id: 'attempt:a',
  generation: 1,
};
test('each role gets independently valid bounded tool schemas and cannot forge chief authority', () => {
  const ajv = new Ajv2020({ strict: true });
  addFormats.default(ajv);
  for (const role of ['chief', 'developer', 'reviewer'] as const) {
    const principal = { kind: 'agent' as const, actor: { ...actor, role } };
    const tools = toolsFor(principal);
    for (const tool of tools) {
      ajv.compile(tool.inputSchema);
      assert.ok(!JSON.stringify(tool.inputSchema).includes('$ref'));
      assert.ok(JSON.stringify(tool.inputSchema).length < 20000);
    }
    assert.equal(
      tools.some((tool) => tool.name === 'create_task'),
      role === 'chief',
    );
    assert.equal(
      tools.some((tool) => tool.name === 'submit_review'),
      role === 'reviewer',
    );
  }
  const call: ToolCall = {
    schema_version: 1,
    request_id: 'request:a',
    idempotency_key: 'key:a',
    run_id: 'run:b',
    expected_version: 0,
    method: 'get_status',
    arguments: { after_seq: 0, limit: 1, task_id: null },
  };
  assert.throws(() => assertToolAuthority({ kind: 'agent', actor }, call), {
    code: 'FORBIDDEN',
  });
});

test('a task agent pages a bounded status and is not refused by an unrelated chief mutation', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'avity status page '));
  const store = new Store(identifyProject(directory, join(directory, 'data')));
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const coordinator = new Coordinator(store, {
    wake: () => {},
    admin: async () => null,
  });
  const timestamp = now();
  const run: Run = {
    id: 'run:status-page',
    project_id: store.project.id,
    objective: 'Read status within native tool limits',
    constraints: [],
    acceptance_criteria: [
      {
        id: 'criterion:status',
        description: 'Status stays readable',
        required: true,
        verification: 'test',
      },
    ],
    delivery_mode: 'documentation',
    status: 'planning',
    chief_provider: 'fake',
    chief_model: null,
    generation: 1,
    version: 0,
    max_active_agents: 2,
    created_at: timestamp,
    updated_at: timestamp,
  };
  store.createRun(run, 'run:create');
  const version = () => store.getRun(run.id).version;
  const user: Actor = {
    id: 'user:local',
    project_id: store.project.id,
    run_id: run.id,
    role: 'user',
    task_id: null,
    attempt_id: null,
    generation: 1,
  };
  const spec: TaskSpec = {
    schema_version: 1,
    id: 'task:status-page',
    run_id: run.id,
    title: 'Worker',
    objective: 'Produce provider output',
    role: 'developer',
    acceptance_criteria: [run.acceptance_criteria[0]!],
    depends_on: [],
    scope: { read_paths: ['**'], write_paths: ['**'], excluded_paths: [] },
    base_revision: null,
    context_source_ids: [],
    expected_deliverables: ['Notes'],
    created_at: timestamp,
  };
  store.updateRunStatus(user, 'running', 'run:running', version());
  store.createTask(user, spec, 'task:create', version());
  const attempt = store.claimTask(
    user,
    spec.id,
    {
      id: 'session:status-page',
      run_id: run.id,
      task_id: spec.id,
      provider: 'fake',
      model: null,
      native_session_id: null,
      cli_version: null,
      cwd: directory,
      capabilities: null,
    },
    'task:claim',
    version(),
  );
  store.observeAttempt(
    user,
    attempt.id,
    { status: 'running', pid: null, exit_code: null },
    'attempt:running',
    version(),
  );
  const worker = {
    kind: 'agent' as const,
    actor: {
      ...user,
      id: 'session:status-page',
      role: 'developer' as const,
      task_id: spec.id,
      attempt_id: attempt.id,
      generation: attempt.generation,
    },
  };
  // 80 transcripts of 20k characters: 1.6M, above the transport and any native tool result.
  for (let index = 0; index < 80; index++)
    store.observation(
      user,
      'provider.tool',
      { text: `${index}:` + 'x'.repeat(20_000) },
      { task_id: spec.id },
    );
  let sequence = 0;
  const call = (method: string, args: unknown, expected_version: number) =>
    ({
      schema_version: 1,
      request_id: `request:${++sequence}`,
      idempotency_key: `key:${sequence}`,
      run_id: run.id,
      expected_version,
      method,
      arguments: args,
    }) as ToolCall;
  type Page = {
    result: { events: CrewEvent[]; next_seq: number; has_more: boolean };
  };
  const seen: string[] = [];
  let after = 0,
    pages = 0;
  for (;;) {
    const page = (await coordinator.execute(
      worker,
      call('get_status', { after_seq: after, limit: 200, task_id: null }, 0),
    )) as Page;
    assert.ok(JSON.stringify(page).length < 45_000);
    for (const event of page.result.events)
      if (event.type === 'provider.tool')
        seen.push((event.payload as { text: string }).text.split(':')[0]!);
    pages++;
    if (!page.result.has_more) break;
    after = page.result.next_seq;
  }
  assert.ok(pages > 1);
  assert.deepEqual(
    seen,
    Array.from({ length: 80 }, (_, index) => String(index)),
  );

  const stale = version();
  const note = (expected: number) =>
    call(
      'publish_note',
      {
        task_id: spec.id,
        kind: 'progress',
        content: 'Still working',
        source_ids: [],
      },
      expected,
    );
  await coordinator.execute(worker, note(stale));
  assert.notEqual(version(), stale);
  // The run moved on, but the worker attempt is still the current authority.
  await coordinator.execute(worker, note(stale));
  await assert.rejects(
    coordinator.execute(
      { kind: 'user', project_id: store.project.id },
      call(
        'send_message',
        {
          recipient_kind: 'task',
          recipient_id: spec.id,
          kind: 'information',
          content: 'Decided on an outdated view',
          source_ids: [],
          requires_ack: false,
        },
        stale,
      ),
    ),
    { code: 'VERSION_CONFLICT' },
  );
});
