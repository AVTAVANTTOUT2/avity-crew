import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import {
  CrewError,
  now,
  runtimeSchema,
} from '../packages/contracts/src/index.ts';
import type { Actor, Run, ToolCall } from '../packages/contracts/src/index.ts';
import { Store, identifyProject } from '../packages/storage/src/index.ts';
import { CapabilityRegistry } from '../packages/supervisor/src/capabilities.ts';
import { SupervisorClient } from '../packages/supervisor/src/client.ts';
import {
  MCP_PROTOCOL_VERSION,
  runMcpBridge,
} from '../packages/supervisor/src/mcp.ts';
import { startTransport } from '../packages/supervisor/src/transport.ts';
import { MAX_JSON_BYTES } from '../packages/supervisor/src/protocol.ts';
import type {
  SupervisorApi,
  TransportHandle,
  ToolDescriptor,
} from '../packages/supervisor/src/protocol.ts';

const isCode = (code: string) => (failure: unknown) =>
  failure instanceof CrewError && failure.code === code;
const call = (key = 'call:one'): ToolCall => ({
  schema_version: 1,
  request_id: key,
  idempotency_key: key,
  run_id: 'run:test',
  expected_version: 0,
  method: 'get_status',
  arguments: { after_seq: 0, limit: 10, task_id: null },
});
const defs = runtimeSchema.$defs as unknown as Record<string, unknown>;
function expanded(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expanded);
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if (typeof item.$ref === 'string')
      return expanded(defs[item.$ref.split('/').at(-1)!]);
    return Object.fromEntries(
      Object.entries(item).map(([key, item]) => [key, expanded(item)]),
    );
  }
  return value;
}
function descriptor(): ToolDescriptor {
  const branches = (
    defs.ToolCall as {
      oneOf: { properties: Record<string, unknown>; required: string[] }[];
    }
  ).oneOf;
  const branch = structuredClone(
    branches.find(
      (branch) =>
        (branch.properties.method as { const: string }).const === 'get_status',
    )!,
  );
  delete branch.properties.method;
  branch.required = branch.required.filter((name) => name !== 'method');
  return {
    name: 'get_status',
    description: 'Transport test callback only',
    inputSchema: expanded(branch) as Record<string, unknown>,
    annotations: { readOnlyHint: true },
  };
}
async function fixture(t: TestContext, start = true) {
  const directory = mkdtempSync(join(tmpdir(), 'avity crew transport '));
  const root = join(directory, 'project');
  mkdirSync(root);
  const project = identifyProject(root, join(directory, 'data'));
  const store = new Store(project);
  const run: Run = {
    id: 'run:test',
    project_id: project.id,
    objective: 'Exercise real local transport with test callbacks',
    constraints: [],
    acceptance_criteria: [
      {
        id: 'AC:test',
        description: 'Transport isolates capabilities',
        required: true,
        verification: 'Node integration tests',
      },
    ],
    delivery_mode: 'documentation',
    status: 'planning',
    chief_provider: 'fake',
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
  const chief: Actor = { ...user, id: 'crew:chief', role: 'chief' };
  const registry = new CapabilityRegistry(store);
  const owner = readFileSync(registry.ownerKeyPath, 'utf8');
  const token = registry.issue(chief);
  // Separate real SQLite database is test-only durable callback state, not supervisor business logic.
  const callbacks = new DatabaseSync(join(directory, 'callback-state.sqlite'));
  callbacks.exec(
    'CREATE TABLE calls (key TEXT PRIMARY KEY, body TEXT NOT NULL, result TEXT NOT NULL)',
  );
  const api: SupervisorApi = {
    tools: (_principal, runId) => {
      store.getRun(runId);
      return [descriptor()];
    },
    execute: async (principal, value) => {
      const body = JSON.stringify(value);
      const prior = callbacks
        .prepare('SELECT body,result FROM calls WHERE key=?')
        .get(value.idempotency_key);
      if (prior) {
        if (!isDeepStrictEqual(JSON.parse(String(prior.body)), value))
          throw new CrewError(
            'IDEMPOTENCY_CONFLICT',
            'Conflicting test request',
          );
        return JSON.parse(String(prior.result));
      }
      const result = {
        identity:
          principal.kind === 'agent' ? principal.actor.id : 'user:local',
        call: value,
      };
      callbacks
        .prepare('INSERT INTO calls VALUES (?,?,?)')
        .run(value.idempotency_key, body, JSON.stringify(result));
      if (value.request_id === 'call:slow') await delay(100);
      return result;
    },
    admin: async (_principal, value) => {
      if (value.method === 'fail') throw new CrewError('TEST_ERROR', owner);
      return { method: value.method };
    },
  };
  const options = {
    directory: project.data_dir,
    project_id: project.id,
    registry,
    api,
  };
  let server: TransportHandle | undefined = start
    ? await startTransport(options)
    : undefined;
  t.after(async () => {
    await server?.close();
    callbacks.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    project,
    store,
    registry,
    run,
    user,
    chief,
    token,
    owner,
    options,
    api,
    callbacks,
    get server() {
      return server!;
    },
    set server(value: TransportHandle) {
      server = value;
    },
    client(capability = token, timeout_ms?: number) {
      return new SupervisorClient({
        endpointFile: join(project.data_dir, 'endpoint.json'),
        capability,
        ...(timeout_ms === undefined ? {} : { timeout_ms }),
      });
    },
    count() {
      return Number(
        callbacks.prepare('SELECT count(*) AS count FROM calls').get()!.count,
      );
    },
  };
}

function raw(
  url: URL,
  capability: string,
  body: string,
  extraHeaders: Record<string, string | number> = {},
): Promise<{ status: number; text: string }> {
  return new Promise((accept, reject) => {
    let received = false;
    const req = request(
      url,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${capability}`,
          'content-type': 'application/json',
          ...('transfer-encoding' in extraHeaders
            ? {}
            : { 'content-length': Buffer.byteLength(body) }),
          ...extraHeaders,
        },
      },
      (response) => {
        received = true;
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
        });
        response.on('end', () =>
          accept({ status: response.statusCode!, text }),
        );
        response.on('error', reject);
      },
    );
    req.on('error', (failure) => {
      if (!received) reject(failure);
    });
    req.end(body);
  });
}

test('real HTTP clients authenticate, constrain run/tools and never accept body Actor or agent admin', async (t) => {
  const f = await fixture(t);
  const clients = [f.client(), f.client()];
  const results = await Promise.all(
    clients.map((client, i) => client.execute(call(`call:${i}`))),
  );
  assert.equal(f.count(), 2);
  assert.ok(
    results.every(
      (result) => (result as { identity: string }).identity === f.chief.id,
    ),
  );
  const tools = await f.client().tools(f.run.id);
  assert.ok(!JSON.stringify(tools).includes('$ref'));
  assert.deepEqual(tools[0]!.inputSchema.required, [
    'schema_version',
    'request_id',
    'idempotency_key',
    'run_id',
    'expected_version',
    'arguments',
  ]);
  await assert.rejects(
    f.client('A'.repeat(43)).execute(call()),
    isCode('FORBIDDEN'),
  );
  await assert.rejects(f.client().tools('run:foreign'), isCode('WRONG_RUN'));
  await assert.rejects(
    f.client().execute({ ...call(), run_id: 'run:foreign' }),
    isCode('WRONG_RUN'),
  );
  await assert.rejects(
    f.client().execute({
      ...call(),
      method: 'inspect_project',
      arguments: { focus: ['project'], requested_source_ids: [] },
    }),
    isCode('FORBIDDEN'),
  );
  const spoof = await raw(
    new URL('call', f.server.endpoint.url),
    f.token,
    JSON.stringify({ ...call(), actor: f.user }),
  );
  assert.equal(spoof.status, 400);
  assert.match(spoof.text, /INVALID_INPUT/);
  await assert.rejects(
    f.client().admin({ method: 'anything', arguments: {} }),
    isCode('FORBIDDEN'),
  );
  assert.deepEqual(
    await f.client(f.owner).admin({ method: 'owner_action', arguments: {} }),
    { method: 'owner_action' },
  );
  const error = await raw(
    new URL('admin', f.server.endpoint.url),
    f.owner,
    JSON.stringify({ method: 'fail', arguments: {} }),
  );
  assert.ok(!error.text.includes(f.owner));
  assert.match(error.text, /TEST_ERROR/);
  assert.equal(f.count(), 2);
  const wrongProject = await startTransport({
    ...f.options,
    directory: join(f.directory, 'wrong-project-service'),
    project_id: 'project:wrong',
  });
  try {
    await assert.rejects(
      new SupervisorClient({
        endpointFile: wrongProject.endpointFile,
        capability: f.owner,
      }).admin({ method: 'owner_action', arguments: {} }),
      isCode('FORBIDDEN'),
    );
  } finally {
    await wrongProject.close();
  }
});

test('capability revocation is observed from real SQLite for every request', async (t) => {
  const f = await fixture(t);
  await f.client().execute(call());
  f.store.updateRunStatus(
    f.user,
    'cancelled',
    'cancel:run',
    f.store.getRun(f.run.id).version,
  );
  await assert.rejects(
    f.client().execute(call('call:after')),
    isCode('REVOKED_CAPABILITY'),
  );
  assert.equal(f.count(), 1);
});

test('a capability revoked while an HTTP body arrives cannot execute with a stale Principal', async (t) => {
  const f = await fixture(t);
  const authenticate = f.registry.authenticate.bind(f.registry);
  let markAuthenticated!: () => void;
  const authenticated = new Promise<void>((accept) => {
    markAuthenticated = accept;
  });
  f.registry.authenticate = (token) => {
    const principal = authenticate(token);
    markAuthenticated();
    return principal;
  };
  const body = JSON.stringify(call());
  const response = new Promise<number>((accept, reject) => {
    const req = request(
      new URL('call', f.server.endpoint.url),
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${f.token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (result) => {
        result.resume();
        result.on('end', () => accept(result.statusCode!));
      },
    );
    req.on('error', reject);
    req.write(body.slice(0, 10));
    void authenticated.then(() => {
      f.store.updateRunStatus(
        f.user,
        'cancelled',
        'cancel:during',
        f.store.getRun(f.run.id).version,
      );
      req.end(body.slice(10));
    });
  });
  assert.equal(await response, 403);
  assert.equal(f.count(), 0);
});

test('single instance, nonce cleanup and endpoint rediscovery preserve ownership', async (t) => {
  const f = await fixture(t);
  const first = f.server.endpoint;
  await assert.rejects(startTransport(f.options), isCode('SUPERVISOR_LOCKED'));
  const onDisk = readFileSync(f.server.endpointFile, 'utf8');
  assert.ok(!onDisk.includes(f.owner) && !onDisk.includes(f.token));
  assert.equal(JSON.parse(onDisk).nonce, first.nonce);
  const reconnectable = f.client();
  await f.server.close();
  await assert.rejects(
    reconnectable.execute(call()),
    isCode('SUPERVISOR_UNAVAILABLE'),
  );
  f.server = await startTransport(f.options);
  assert.notEqual(f.server.endpoint.nonce, first.nonce);
  assert.equal(
    ((await reconnectable.execute(call())) as { identity: string }).identity,
    f.chief.id,
  );
  const foreign = randomUUID();
  const lock = join(f.project.data_dir, 'supervisor.lock');
  writeFileSync(
    lock,
    JSON.stringify({ ...f.server.endpoint, nonce: foreign }),
    { mode: 0o600 },
  );
  writeFileSync(
    f.server.endpointFile,
    JSON.stringify({ ...f.server.endpoint, nonce: foreign }),
    { mode: 0o600 },
  );
  await f.server.close();
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).nonce, foreign);
  assert.equal(
    JSON.parse(readFileSync(f.server.endpointFile, 'utf8')).nonce,
    foreign,
  );
});

test('verified stale ownership is reclaimed, live or ambiguous locks are not removed', async (t) => {
  const f = await fixture(t, false);
  const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
  await once(child, 'exit');
  const stale = {
    protocol: 1,
    project_id: f.project.id,
    pid: child.pid!,
    nonce: randomUUID(),
    url: `http://127.0.0.1:1/v1/${randomUUID()}/`,
  };
  const lock = join(f.project.data_dir, 'supervisor.lock');
  writeFileSync(lock, JSON.stringify(stale), { mode: 0o600 });
  writeFileSync(
    join(f.project.data_dir, 'endpoint.json'),
    JSON.stringify(stale),
    { mode: 0o600 },
  );
  const starts = await Promise.allSettled([
    startTransport(f.options),
    startTransport(f.options),
  ]);
  assert.equal(starts.filter((item) => item.status === 'fulfilled').length, 1);
  f.server = (
    starts.find(
      (item) => item.status === 'fulfilled',
    ) as PromiseFulfilledResult<TransportHandle>
  ).value;
  assert.notEqual(f.server.endpoint.nonce, stale.nonce);
  await f.server.close();
  writeFileSync(lock, '{malformed ownership', { mode: 0o600 });
  await assert.rejects(startTransport(f.options));
  assert.equal(readFileSync(lock, 'utf8'), '{malformed ownership');
  assert.equal(
    existsSync(join(f.project.data_dir, 'supervisor.starting')),
    false,
  );
});

test('HTTP JSON limits, invalid JSON, client disconnect and absolute deadline stay explicit', async (t) => {
  const f = await fixture(t);
  const url = new URL('call', f.server.endpoint.url);
  assert.equal((await raw(url, f.token, '{')).status, 400);
  assert.equal(
    (await raw(url, f.token, '{}', { 'content-length': MAX_JSON_BYTES + 1 }))
      .status,
    413,
  );
  assert.equal(
    (
      await raw(url, f.token, 'x'.repeat(MAX_JSON_BYTES + 1), {
        'transfer-encoding': 'chunked',
      })
    ).status,
    413,
  );
  const disconnected = request(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${f.token}`,
      'content-type': 'application/json',
      'content-length': 10,
    },
  });
  disconnected.on('error', () => {});
  disconnected.write('{');
  disconnected.destroy();
  await assert.rejects(
    f.client(f.token, 5).execute(call('call:slow')),
    isCode('SUPERVISOR_UNAVAILABLE'),
  );
  assert.deepEqual(await f.client().execute(call('call:slow')), {
    identity: f.chief.id,
    call: call('call:slow'),
  });
  assert.equal(f.count(), 1);
  await assert.rejects(
    f.client(f.owner).admin({
      method: 'oversized',
      arguments: { content: 'x'.repeat(MAX_JSON_BYTES) },
    }),
    isCode('BODY_TOO_LARGE'),
  );
  const original = readFileSync(f.server.endpointFile, 'utf8');
  writeFileSync(
    f.server.endpointFile,
    JSON.stringify({ ...f.server.endpoint, url: 'https://example.com/' }),
    { mode: 0o600 },
  );
  await assert.rejects(
    f.client().execute(call()),
    isCode('SUPERVISOR_UNAVAILABLE'),
  );
  writeFileSync(f.server.endpointFile, original, { mode: 0o600 });
});

test('real MCP stdio and CLI fallback carry the same ToolCall, independent of JSON-RPC ids', async (t) => {
  const f = await fixture(t);
  const first = call('call:mcp1'),
    second = call('call:mcp2');
  const envelope = (value: ToolCall) => {
    const { method: _method, ...args } = value;
    return args;
  };
  const messages = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2099-unknown',
        capabilities: {},
        clientInfo: { name: 'transport-test', version: '1' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: first.method, arguments: envelope(first) },
    },
    {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: second.method, arguments: envelope(second) },
    },
    {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: first.method,
        arguments: {
          schema_version: 1,
          run_id: first.run_id,
          expected_version: 0,
          arguments: first.arguments,
        },
      },
    },
  ];
  const child = spawn(
    process.execPath,
    [resolve('tests/fixtures/supervisor/mcp-child.mjs')],
    {
      env: {
        ...process.env,
        AVITY_CREW_ENDPOINT_FILE: f.server.endpointFile,
        AVITY_CREW_CAPABILITY: f.token,
        AVITY_CREW_RUN_ID: f.run.id,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk;
  });
  child.stdin.end(
    messages.map((item) => JSON.stringify(item)).join('\n') + '\n',
  );
  const [code] = await once(child, 'close');
  assert.equal(code, 0);
  assert.ok(!stdout.includes(f.token) && !stderr.includes(f.token));
  const responses = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(responses[0].result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.notEqual(responses[0].result.protocolVersion, '2099-unknown');
  assert.equal(responses.filter((item) => item.id === 7).length, 2);
  assert.ok(responses.find((item) => item.id === 8).error);
  const mcpResult = JSON.parse(
    responses.find((item) => item.id === 7).result.content[0].text,
  );
  assert.deepEqual(await f.client().execute(first), mcpResult);
  assert.equal(f.count(), 2);
});

test('MCP rejects uninitialized, malformed and oversized input with protocol-only output', async (t) => {
  const f = await fixture(t);
  const input = new PassThrough(),
    output = new PassThrough();
  let text = '';
  output.on('data', (chunk: Buffer) => {
    text += chunk;
  });
  const running = runMcpBridge({
    client: f.client(),
    runId: f.run.id,
    input,
    output,
  });
  input.end(
    '{invalid}\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) +
      '\n' +
      'x'.repeat(MAX_JSON_BYTES + 1),
  );
  await running;
  const responses = text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    responses.map((item) => item.error.code),
    [-32700, -32000, -32600],
  );
  assert.equal(f.count(), 0);
});
