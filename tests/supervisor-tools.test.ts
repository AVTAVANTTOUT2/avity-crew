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
  Operation,
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

test('a chief status page stays bounded when its records and a single event exceed the room', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'avity status bound '));
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
    id: 'run:status-bound',
    project_id: store.project.id,
    objective: 'Keep the chief page within native tool limits',
    constraints: [],
    acceptance_criteria: [
      {
        id: 'criterion:bound',
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
  store.updateRunStatus(user, 'running', 'run:running', version());
  // One event whose clipped payload alone exceeds a page.
  store.observation(user, 'provider.tool', {
    items: Array.from({ length: 200 }, () => 'y'.repeat(500)),
  });
  store.observation(user, 'provider.text', { text: 'small' });
  // 120 user messages of 1 000 characters: the records alone exceed the page.
  for (let index = 0; index < 120; index++)
    store.sendMessage(
      user,
      {
        id: `message:${index}`,
        run_id: run.id,
        sender_id: user.id,
        recipient_kind: 'chief',
        recipient_id: `control:${run.id}`,
        kind: 'information',
        content: `${index}:` + 'm'.repeat(1_000),
        source_ids: [],
        status: 'queued',
        created_at: timestamp,
      },
      `message:${index}`,
      version(),
    );
  const chief = {
    kind: 'agent' as const,
    actor: { ...user, id: 'session:chief', role: 'chief' as const },
  };
  type Page = {
    result: {
      events: CrewEvent[];
      messages: unknown[];
      record_limit?: number;
      next_seq: number;
      has_more: boolean;
    };
  };
  const seen: string[] = [];
  let after = 0;
  for (let request = 1; ; request++) {
    const page = (await coordinator.execute(chief, {
      schema_version: 1,
      request_id: `request:${request}`,
      idempotency_key: `key:${request}`,
      run_id: run.id,
      expected_version: version(),
      method: 'get_status',
      arguments: { after_seq: after, limit: 200, task_id: null },
    })) as Page;
    assert.ok(JSON.stringify(page).length < 41_000);
    assert.ok(page.result.record_limit! < 200);
    assert.ok(page.result.messages.length > 0);
    assert.ok(page.result.next_seq > after, 'Each page must progress');
    for (const event of page.result.events)
      if (event.type.startsWith('provider.'))
        seen.push(
          'omitted' in event.payload ? `${event.type}:omitted` : event.type,
        );
    if (!page.result.has_more) break;
    after = page.result.next_seq;
  }
  assert.deepEqual(seen, ['provider.tool:omitted', 'provider.text']);
});

test('a failed tool call closes its operation and its key can still complete as a new attempt', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'avity tool journal '));
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
    id: 'run:tool-journal',
    project_id: store.project.id,
    objective: 'Journal every tool outcome',
    constraints: [],
    acceptance_criteria: [
      {
        id: 'criterion:journal',
        description: 'Operations are closed',
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
  store.updateRunStatus(user, 'running', 'run:running', version());
  const owner = { kind: 'user' as const, project_id: store.project.id };
  const message = (): ToolCall => ({
    schema_version: 1,
    request_id: 'request:message',
    idempotency_key: 'key:message',
    run_id: run.id,
    expected_version: version(),
    method: 'send_message',
    arguments: {
      recipient_kind: 'task',
      recipient_id: 'task:later',
      kind: 'information',
      content: 'Contexte pour la mission',
      source_ids: [],
      requires_ack: false,
    },
  });
  const journal = () =>
    store
      .records<Operation>(run.id, 'operation')
      .filter((operation) => operation.kind === 'tool.send_message')
      .map((operation) => operation.status);
  await assert.rejects(coordinator.execute(owner, message()), {
    code: 'NOT_FOUND',
  });
  assert.deepEqual(journal(), ['failed']);
  assert.deepEqual(store.uncertainOperations(run.id), []);
  store.createTask(
    user,
    {
      schema_version: 1,
      id: 'task:later',
      run_id: run.id,
      title: 'Later',
      objective: 'Receive context',
      role: 'documenter',
      acceptance_criteria: [run.acceptance_criteria[0]!],
      depends_on: [],
      scope: { read_paths: ['**'], write_paths: ['**'], excluded_paths: [] },
      base_revision: null,
      context_source_ids: [],
      expected_deliverables: ['Notes'],
      created_at: timestamp,
    },
    'task:create',
    version(),
  );
  const sent = await coordinator.execute(owner, message());
  assert.deepEqual(journal(), ['failed', 'completed']);
  // A lost reply is replayed from the completed attempt without a new one.
  assert.deepEqual(
    (await coordinator.execute(owner, message())) as { result: unknown },
    { ...(sent as object), run_version: version() },
  );
  assert.deepEqual(journal(), ['failed', 'completed']);
});
