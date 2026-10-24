import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { parseCli } from '../apps/cli/src/args.ts';
import { cleanText, clipLine, renderSnapshot } from '../apps/cli/src/view.ts';
import {
  ensureService,
  serviceArguments,
  userClient,
} from '../apps/cli/src/service.ts';
import { now, runtimeSchema } from '../packages/contracts/src/index.ts';
import type { Actor, Run } from '../packages/contracts/src/index.ts';
import { identifyProject, Store } from '../packages/storage/src/index.ts';
import { CapabilityRegistry } from '../packages/supervisor/src/capabilities.ts';
import { startTransport } from '../packages/supervisor/src/transport.ts';
import type {
  SupervisorApi,
  ToolDescriptor,
} from '../packages/supervisor/src/protocol.ts';

const cli = resolve('bin/avity-crew.mjs');
const defs = runtimeSchema.$defs as unknown as Record<string, unknown>;
function expand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    if (typeof row.$ref === 'string')
      return expand(defs[row.$ref.split('/').at(-1)!]);
    return Object.fromEntries(
      Object.entries(row).map(([key, item]) => [key, expand(item)]),
    );
  }
  return value;
}
function tools(): ToolDescriptor[] {
  const branches = (
    defs.ToolCall as {
      oneOf: { properties: Record<string, unknown>; required: string[] }[];
    }
  ).oneOf;
  return ['get_status', 'send_message'].map((name) => {
    const branch = structuredClone(
      branches.find(
        (branch) =>
          (branch.properties.method as { const: string }).const === name,
      )!,
    );
    delete branch.properties.method;
    branch.required = branch.required.filter((key) => key !== 'method');
    return {
      name: name as 'get_status',
      description: 'Fake CLI test callback',
      inputSchema: expand(branch) as Record<string, unknown>,
    };
  });
}
async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'avity CLI tests '));
  const root = join(directory, 'project with spaces');
  mkdirSync(root);
  const dataHome = join(directory, 'private-data');
  const project = identifyProject(root, dataHome);
  const store = new Store(project);
  const run: Run = {
    id: 'run:test',
    project_id: project.id,
    objective: 'Objectif de test explicitement fake',
    constraints: [],
    acceptance_criteria: [
      {
        id: 'AC:one',
        description: 'Observe the fake transport only',
        verification: 'Node tests',
        required: true,
      },
    ],
    delivery_mode: 'documentation',
    status: 'running',
    chief_provider: 'fake',
    chief_model: null,
    generation: 1,
    version: 7,
    max_active_agents: 7,
    created_at: now(),
    updated_at: now(),
  };
  store.createRun({ ...run, status: 'planning', version: 0 }, 'create:run');
  const actor: Actor = {
    id: 'crew:test',
    project_id: project.id,
    run_id: run.id,
    role: 'chief',
    task_id: null,
    attempt_id: null,
    generation: 1,
  };
  const registry = new CapabilityRegistry(store);
  const token = registry.issue(actor);
  const db = new DatabaseSync(join(directory, 'cli-observations.sqlite'));
  db.exec('CREATE TABLE calls (method TEXT, data TEXT)');
  let seq = 0;
  const snapshot = (after = 0) => ({
    project,
    run,
    tasks: [
      {
        id: 'task:one',
        spec: { title: 'Agent bloqué', role: 'developer' },
        status: 'waiting_dependency',
        wait_reason: 'Contrat indisponible',
      },
    ],
    events: [
      {
        seq: ++seq,
        type: 'message',
        payload: { content: 'Nouveau fait \u001b]52;c;INJECTED\u0007' },
      },
    ].filter((event) => event.seq > after),
    next_seq: seq,
    sessions: [
      { id: 'session:one', provider: 'fake', model: null, task_id: 'task:one' },
    ],
    questions: [{ id: 'question:one', question: 'Confirmer le critère ?' }],
    activity: [],
    verifications: [],
    contexts: [],
    decisions: [],
    blockers: ['Attente de dépendance'],
    fake: true,
  });
  const api: SupervisorApi = {
    tools: () => tools(),
    execute: async (principal, call) => {
      db.prepare('INSERT INTO calls VALUES (?,?)').run(
        call.method,
        JSON.stringify(call),
      );
      return {
        fake: true,
        principal:
          principal.kind === 'agent' ? principal.actor.id : 'user:local',
        call,
        status: call.method === 'send_message' ? 'queued' : 'observed',
      };
    },
    admin: async (_principal, request) => {
      db.prepare('INSERT INTO calls VALUES (?,?)').run(
        request.method,
        JSON.stringify(request.arguments),
      );
      if (request.method === 'status')
        return snapshot(Number(request.arguments.after_seq ?? 0));
      if (request.method === 'create_run') {
        run.status = 'running';
        return { ...run, fake: true, verification: 'unverified' };
      }
      if (request.method === 'list_runs') return [run];
      if (request.method === 'inspect_context')
        return {
          bundle: { id: 'context:test', prompt: 'EXACT_FAKE_PROMPT' },
          fake: true,
        };
      if (request.method === 'export')
        return '# Rapport fake\nAucune recette réelle revendiquée.\n';
      return {
        method: request.method,
        arguments: request.arguments,
        fake: true,
        requested: true,
      };
    },
  };
  let server = await startTransport({
    directory: project.data_dir,
    project_id: project.id,
    registry,
    api,
  });
  t.after(async () => {
    await server.close();
    db.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    root,
    dataHome,
    project,
    run,
    registry,
    token,
    api,
    db,
    get server() {
      return server;
    },
    set server(value) {
      server = value;
    },
    calls(method: string) {
      return db
        .prepare('SELECT data FROM calls WHERE method=?')
        .all(method)
        .map((row) => JSON.parse(String(row.data)));
    },
  };
}
async function child(
  args: string[],
  cwd: string,
  dataHome: string,
  input = '',
  extraEnv: Record<string, string> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const processChild = spawn(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, XDG_DATA_HOME: dataHome, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '';
  processChild.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk;
  });
  processChild.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk;
  });
  processChild.stdin.end(input);
  return new Promise((accept, reject) => {
    processChild.on('error', reject);
    processChild.on('close', (code) => accept({ code, stdout, stderr }));
  });
}

test('CLI parsing validates every mutation option before project/service side effects', async () => {
  for (const argv of [
    ['run', 'objectif'],
    ['run', 'objectif', '--criterion', 'OK', '--max-agents', '0'],
    ['run', 'objectif', '--criterion', 'OK', '--chief', 'wrong'],
    [
      'run',
      'objectif',
      '--criterion',
      'OK',
      '--mode',
      'documentation',
      '--init-git',
    ],
    ['pause'],
    ['answer', '--run', 'run:test', 'texte'],
    ['internal', 'call', '--json'],
  ])
    assert.throws(() => parseCli(argv));
  const command = parseCli([
    'run',
    '--criterion',
    'État vérifié',
    '--criterion',
    'Isolation préservée',
    '--constraint',
    'Ne rien publier',
    '--chief',
    'claude',
    '--model',
    'choix utilisateur',
    '--max-agents',
    '2',
    '--mode',
    'documentation',
    '--',
    'objectif ; $(ne-pas-exécuter)',
  ]);
  assert.equal(command.text, 'objectif ; $(ne-pas-exécuter)');
  assert.equal(command.criteria.length, 2);
  const directory = mkdtempSync(join(tmpdir(), 'avity invalid CLI '));
  try {
    const root = join(directory, 'project');
    mkdirSync(root);
    const data = join(directory, 'absent-data');
    const result = await child(
      [
        'run',
        'objectif',
        '--criterion',
        'OK',
        '--mode',
        'documentation',
        '--init-git',
        '--json',
      ],
      root,
      data,
    );
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stdout).ok, false);
    assert.equal(existsSync(data), false);
    assert.equal(existsSync(join(root, '.git')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI subprocess in another cwd creates only one fake request and exposes observed data', async (t) => {
  const f = await fixture(t);
  const result = await child(
    [
      'run',
      'Créer é🧪 ; $(touch SHOULD_NOT_EXIST)',
      '--criterion',
      'Vérification explicite',
      '--constraint',
      'Ne rien publier',
      '--mode',
      'documentation',
      '--chief',
      'codex',
      '--max-agents',
      '2',
      '--json',
    ],
    f.root,
    f.dataHome,
  );
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schema_version, 1);
  assert.equal(payload.data.fake, true);
  assert.equal(payload.data.verification, 'unverified');
  assert.equal(f.calls('create_run').length, 1);
  assert.equal(
    f.calls('create_run')[0].objective,
    'Créer é🧪 ; $(touch SHOULD_NOT_EXIST)',
  );
  assert.deepEqual(f.calls('create_run')[0].criteria, [
    'Vérification explicite',
  ]);
  assert.equal(existsSync(join(f.root, 'SHOULD_NOT_EXIST')), false);
  assert.equal(existsSync(join(f.root, '.git')), false);
  const status = await child(['status', '--json'], f.root, f.dataHome);
  assert.equal(JSON.parse(status.stdout).data.project.root, f.project.root);
  const context = await child(
    ['inspect-context', '--run', 'run:test', '--subject', 'task:one', '--json'],
    f.root,
    f.dataHome,
  );
  assert.equal(
    JSON.parse(context.stdout).data.bundle.prompt,
    'EXACT_FAKE_PROMPT',
  );
  const answer = await child(
    [
      'answer',
      '--run',
      'run:test',
      '--question',
      'question:one',
      'Réponse utilisateur',
      '--json',
    ],
    f.root,
    f.dataHome,
  );
  assert.equal(answer.code, 0);
  assert.equal(f.calls('answer')[0].question_id, 'question:one');
  const note = await child(
    ['message', '--run', 'run:test', 'Note au chef', '--json'],
    f.root,
    f.dataHome,
  );
  assert.equal(JSON.parse(note.stdout).data.result.status, 'queued');
  const sent = f.calls('send_message')[0];
  assert.equal(sent.expected_version, 7);
  assert.equal(sent.arguments.recipient_id, 'chief:current');
  assert.equal(sent.arguments.requires_ack, true);
  assert.ok(sent.idempotency_key);
});

test('internal call uses ENV capability and preserves the exact ToolCall without reading owner metadata', async (t) => {
  const f = await fixture(t);
  const call = {
    schema_version: 1,
    request_id: 'request:internal',
    idempotency_key: 'key:internal',
    run_id: f.run.id,
    expected_version: 7,
    method: 'get_status',
    arguments: { after_seq: 0, limit: 10, task_id: null },
  };
  const result = await child(
    ['internal', 'call'],
    f.root,
    join(f.directory, 'unused-data'),
    JSON.stringify(call),
    {
      AVITY_CREW_ENDPOINT_FILE: f.server.endpointFile,
      AVITY_CREW_CAPABILITY: f.token,
    },
  );
  assert.equal(result.code, 0);
  assert.deepEqual(f.calls('get_status')[0], call);
  assert.equal(JSON.parse(result.stdout).data.principal, 'crew:test');
  assert.ok(
    !result.stdout.includes(f.token) && !result.stderr.includes(f.token),
  );
  assert.equal(existsSync(join(f.directory, 'unused-data')), false);
  const bad = await child(
    ['internal', 'call'],
    f.root,
    f.dataHome,
    JSON.stringify({ ...call, actor: { role: 'user' } }),
    {
      AVITY_CREW_ENDPOINT_FILE: f.server.endpointFile,
      AVITY_CREW_CAPABILITY: f.token,
    },
  );
  assert.equal(bad.code, 2);
  assert.equal(f.calls('get_status').length, 1);
});

test('CLI file/stdin objectives and every control route preserve the explicit admin contract', async (t) => {
  const f = await fixture(t);
  writeFileSync(
    join(f.root, 'mission with spaces.md'),
    'Objectif fichier é🧪\nDeuxième ligne.',
  );
  assert.equal(
    (
      await child(
        [
          'run',
          '--prompt-file',
          'mission with spaces.md',
          '--criterion',
          'Preuve fichier',
          '--mode',
          'documentation',
          '--json',
        ],
        f.root,
        f.dataHome,
      )
    ).code,
    0,
  );
  assert.equal(
    (
      await child(
        [
          'run',
          '-',
          '--criterion',
          'Preuve stdin',
          '--mode',
          'documentation',
          '--json',
        ],
        f.root,
        f.dataHome,
        'Objectif stdin é🧪\nPréservé.',
      )
    ).code,
    0,
  );
  assert.equal(
    f.calls('create_run')[0].objective,
    'Objectif fichier é🧪\nDeuxième ligne.',
  );
  assert.equal(
    f.calls('create_run')[1].objective,
    'Objectif stdin é🧪\nPréservé.',
  );
  for (const [argv, method] of [
    [['pause', '--run', 'run:test'], 'pause'],
    [['resume', '--run', 'run:test'], 'resume'],
    [['stop', '--run', 'run:test'], 'stop'],
    [
      [
        'replace-chief',
        '--run',
        'run:test',
        '--provider',
        'claude',
        '--model',
        'configured-model',
      ],
      'replace_chief',
    ],
    [['reassign', '--run', 'run:test', '--task', 'task:one'], 'reassign'],
    [['list'], 'list_runs'],
    [['doctor'], 'doctor'],
    [['export', '--run', 'run:test', '--format', 'markdown'], 'export'],
    [['service', 'stop'], 'shutdown'],
  ] as const) {
    const result = await child([...argv, '--json'], f.root, f.dataHome);
    assert.equal(result.code, 0, method);
    assert.equal(JSON.parse(result.stdout).ok, true);
    assert.ok(f.calls(method).length > 0);
  }
  assert.equal(f.calls('replace_chief')[0].provider, 'claude');
  assert.equal(f.calls('replace_chief')[0].model, 'configured-model');
  assert.equal(f.calls('reassign')[0].task_id, 'task:one');
});

test('internal mcp remains pure JSON-RPC over the same capability-backed call', async (t) => {
  const f = await fixture(t);
  const input =
    [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'cli-test', version: '1' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get_status',
          arguments: {
            schema_version: 1,
            request_id: 'request:mcp',
            idempotency_key: 'key:mcp',
            run_id: f.run.id,
            expected_version: 7,
            arguments: { after_seq: 0, limit: 10, task_id: null },
          },
        },
      },
    ]
      .map((value) => JSON.stringify(value))
      .join('\n') + '\n';
  const result = await child(['internal', 'mcp'], f.root, f.dataHome, input, {
    AVITY_CREW_ENDPOINT_FILE: f.server.endpointFile,
    AVITY_CREW_CAPABILITY: f.token,
    AVITY_CREW_RUN_ID: f.run.id,
  });
  assert.equal(result.code, 0);
  const messages = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(messages.every((value) => value.jsonrpc === '2.0'));
  assert.equal(f.calls('get_status')[0].idempotency_key, 'key:mcp');
  assert.ok(
    !result.stdout.includes(f.token) && !result.stderr.includes(f.token),
  );
});

test('watch detaches without controlling the service and reconnects with its cursor', async (t) => {
  const f = await fixture(t);
  const viewing = child(
    ['watch', '--json', '--timeout', '1400'],
    f.root,
    f.dataHome,
  );
  await delay(350);
  await f.server.close();
  await delay(650);
  f.server = await startTransport({
    directory: f.project.data_dir,
    project_id: f.project.id,
    registry: f.registry,
    api: f.api,
  });
  const result = await viewing;
  assert.equal(result.code, 4);
  const rows = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const seqs = rows
    .flatMap((row) => row.data?.events ?? [])
    .map((event) => event.seq);
  assert.ok(
    rows.some(
      (row) => row.ok === false && row.error.code === 'SUPERVISOR_UNAVAILABLE',
    ),
  );
  assert.equal(new Set(seqs).size, seqs.length);
  assert.ok(seqs.length >= 2);
  assert.equal(f.calls('create_run').length, 0);
  assert.equal(f.calls('stop').length, 0);
  assert.equal(f.calls('shutdown').length, 0);
  assert.ok(
    f
      .calls('status')
      .slice(1)
      .every((args) => args.run_id === 'run:test'),
  );
  assert.equal((await child(['status', '--json'], f.root, f.dataHome)).code, 0);
});

test('watch once distinguishes waits, failed goals and verified completion', async (t) => {
  const f = await fixture(t);
  for (const [status, code] of [
    ['waiting_provider', 4],
    ['waiting_user', 5],
    ['failed', 1],
    ['completed', 0],
    ['cancelled', 130],
  ] as const) {
    f.run.status = status;
    const result = await child(
      ['watch', '--run', 'run:test', '--once', '--json'],
      f.root,
      f.dataHome,
    );
    assert.equal(result.code, code, status);
    assert.equal(JSON.parse(result.stdout).data.run.status, status);
  }
});

test('service launch is detached with private log and no capability or objective in argv', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'avity service launch '));
  const root = join(directory, 'project');
  mkdirSync(root);
  const dataHome = join(directory, 'data');
  const project = identifyProject(root, dataHome);
  const previousHome = process.env.XDG_DATA_HOME,
    previousCap = process.env.AVITY_CREW_CAPABILITY;
  process.env.XDG_DATA_HOME = dataHome;
  process.env.AVITY_CREW_CAPABILITY = 'CAPABILITY_MUST_NOT_PROPAGATE';
  t.after(async () => {
    try {
      await userClient(project).admin({ method: 'shutdown', arguments: {} });
    } catch {}
    if (previousHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousHome;
    if (previousCap === undefined) delete process.env.AVITY_CREW_CAPABILITY;
    else process.env.AVITY_CREW_CAPABILITY = previousCap;
    await delay(100);
    rmSync(directory, { recursive: true, force: true });
  });
  const entry = resolve('tests/fixtures/cli/service.mjs');
  const client = await ensureService(project, entry);
  assert.ok(client);
  const audit = JSON.parse(
    readFileSync(join(project.data_dir, 'launch-audit.json'), 'utf8'),
  );
  assert.deepEqual(audit.argv, ['--project', project.root]);
  assert.equal(audit.capability_in_env, false);
  assert.deepEqual(serviceArguments(project.root, entry), [
    entry,
    '--project',
    project.root,
  ]);
  assert.equal(
    serviceArguments(project.root)[0],
    resolve('dist/packages/supervisor/src/main.js'),
  );
  assert.equal(
    lstatSync(join(project.data_dir, 'service.log')).mode & 0o077,
    0,
  );
  const owner = readFileSync(join(project.data_dir, 'owner.key'), 'utf8');
  assert.ok(
    !readFileSync(join(project.data_dir, 'service.log'), 'utf8').includes(
      owner,
    ),
  );
});

test('terminal rendering escapes agent controls and keeps Unicode clipping valid', () => {
  assert.equal(
    cleanText('safe\u001b]52;c;evil\u0007\u001b[31mtext\r'),
    'safetext ',
  );
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(clipLine('🧪🧪🧪', 3)));
  const view = renderSnapshot(
    {
      project: { root: '/project with spaces' },
      run: {
        id: 'run:test',
        objective: 'Objectif',
        status: 'waiting_provider',
        max_active_agents: 7,
      },
      tasks: [],
      sessions: [],
      events: [
        {
          seq: 1,
          type: 'note',
          payload: { content: '\u001b]52;c;evil\u0007' },
        },
      ],
      contexts: [],
    },
    30,
    18,
  );
  assert.match(view, /attente fournisseur/);
  assert.ok(!view.includes('\u001b]52'));
  assert.ok(!view.includes('%'));
  assert.match(view, /usage réel : indisponible|Contexte/);
  const conversation = renderSnapshot(
    {
      project: { root: '/project' },
      run: { id: 'run:test', objective: 'Conversation', status: 'running' },
      activity: {
        active: [{ run_id: 'run:test' }],
        queued: [{ run_id: 'run:other' }],
      },
      tasks: [],
      sessions: [],
      contexts: [],
      events: [
        {
          seq: 1,
          type: 'provider.text',
          session_id: 'session:chief',
          payload: {
            text: 'Réponse du chef é🧪\nLigne suivante',
            provenance: 'live',
          },
        },
        {
          seq: 2,
          type: 'provider.usage',
          payload: {
            provenance: 'live',
            usage: { input_tokens: 12, output_tokens: 5 },
          },
        },
      ],
    },
    100,
    60,
  );
  assert.match(conversation, /Tours actifs : 1 \| Tours en file : 0/);
  assert.match(conversation, /Conversation :/);
  assert.match(conversation, /^Réponse du chef é🧪/m);
  assert.match(
    conversation,
    /usage déclaré du dernier tour : entrée 12, sortie 5/,
  );
});

const ptyAvailable =
  process.platform !== 'win32' &&
  spawnSync('python3', ['--version']).status === 0;
test(
  'real PTY wizard accepts a pasted multiline goal and remains attached to the newly created Run',
  { skip: !ptyAvailable },
  async (t) => {
    const f = await fixture(t);
    f.run.status = 'completed';
    const python = spawn(
      'python3',
      [
        resolve('tests/fixtures/cli/terminal_driver.py'),
        'wizard',
        process.execPath,
        cli,
        f.root,
      ],
      {
        env: { ...process.env, XDG_DATA_HOME: f.dataHome },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    python.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk;
    });
    const code = await new Promise((accept) => python.on('close', accept));
    assert.equal(code, 0);
    const report = JSON.parse(stdout);
    assert.equal(report.timed_out, false);
    assert.equal(report.code, 4);
    assert.equal(f.calls('create_run').length, 1);
    assert.equal(
      f.calls('create_run')[0].objective,
      'Nouvel objectif é🧪\nDeuxième ligne',
    );
    assert.deepEqual(f.calls('create_run')[0].criteria, ['Critère observable']);
    assert.equal(f.calls('stop').length, 0);
    assert.equal(f.calls('shutdown').length, 0);
  },
);
test(
  'real PTY preserves typed Unicode across events/resize and q/CtrlC only detach',
  { skip: !ptyAvailable },
  async (t) => {
    const f = await fixture(t);
    for (const mode of ['typing', 'interrupt']) {
      const python = spawn(
        'python3',
        [
          resolve('tests/fixtures/cli/terminal_driver.py'),
          mode,
          process.execPath,
          cli,
          f.root,
        ],
        {
          env: { ...process.env, XDG_DATA_HOME: f.dataHome },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      python.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk;
      });
      const code = await new Promise((accept) => python.on('close', accept));
      assert.equal(code, 0);
      const report = JSON.parse(stdout);
      assert.equal(report.timed_out, false);
      assert.equal(report.code, mode === 'typing' ? 4 : 130);
      assert.ok(!report.output.includes('\u001b]52'));
    }
    assert.equal(f.calls('send_message')[0].arguments.content, 'brouillon é🧪');
    assert.equal(f.calls('stop').length, 0);
    assert.equal(f.calls('shutdown').length, 0);
    assert.equal(
      (await child(['status', '--json'], f.root, f.dataHome)).code,
      0,
    );
  },
);
