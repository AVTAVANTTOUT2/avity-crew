import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  CodexProvider,
  decodeCodexEvent,
} from '../../packages/providers/src/codex.ts';
import type {
  ProviderEvent,
  ProviderProcess,
  ProviderRequest,
} from '../../packages/contracts/src/index.ts';

const fixture = fileURLToPath(
  new URL('../../../tests/fixtures/providers/codex-cli.mjs', import.meta.url),
);
const provider = new CodexProvider(fixture);
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const request = (prompt: unknown, cwd = resolve('.')): ProviderRequest => ({
  cwd,
  prompt: JSON.stringify(prompt),
  model: null,
  role: 'developer',
  permissions: { sandbox: 'workspace-write', approval: 'never' },
});
const collect = async (run: ProviderProcess) => {
  const events: ProviderEvent[] = [];
  const consuming = (async () => {
    for await (const event of run.events) events.push(event);
  })();
  const result = await run.result;
  await consuming;
  return { events, result };
};

test('Codex normalizes session, tool IDs, text, usage and completion', () => {
  assert.deepEqual(
    decodeCodexEvent({ type: 'thread.started', thread_id: first }),
    [{ type: 'session', native_session_id: first, provenance: 'live' }],
  );
  for (const type of [
    'command_execution',
    'file_change',
    'mcp_tool_call',
    'web_search',
    'todo_list',
  ]) {
    const events = decodeCodexEvent({
      type: 'item.completed',
      item: {
        id: 'tool_4',
        type,
        command: 'ls',
        changes: [{ path: 'a.ts', kind: 'add' }],
        server: 'crew',
        tool: 'ping',
        result: { content: 'pong' },
      },
    });
    assert.equal(events[0]?.type, 'tool');
    assert.match(events[0]?.text ?? '', /tool_4/);
  }
  assert.deepEqual(
    decodeCodexEvent({
      type: 'item.updated',
      item: { type: 'agent_message', text: 'partial' },
    }),
    [],
  );
  assert.deepEqual(
    decodeCodexEvent({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'final' },
    }),
    [{ type: 'text', text: 'final', provenance: 'live' }],
  );
  assert.deepEqual(
    decodeCodexEvent({
      type: 'turn.completed',
      usage: { input_tokens: 12, output_tokens: 5, cost_usd: 9 },
    }),
    [
      {
        type: 'usage',
        usage: { input_tokens: 12, output_tokens: 5 },
        provenance: 'live',
      },
      { type: 'result', success: true, provenance: 'live' },
    ],
  );
  assert.deepEqual(
    decodeCodexEvent({
      type: 'turn.completed',
      usage: { input_tokens: -1, output_tokens: '9' },
    }),
    [{ type: 'result', success: true, provenance: 'live' }],
  );
});

test('Codex preserves unknown diagnostics and classifies provider errors', () => {
  for (const event of [
    null,
    { type: 'new.event' },
    { type: 'item.completed', item: { type: 'new.item', id: 'new_2' } },
  ])
    assert.equal(decodeCodexEvent(event)[0]?.type, 'unknown');
  for (const [message, kind] of [
    ['Usage limit reached', 'quota'],
    ['Authentication failed; please login', 'authentication'],
    ['Permission denied', 'permission'],
    ['Network connection failed', 'network'],
  ]) {
    const events = decodeCodexEvent({
      type: 'turn.failed',
      error: { message },
    });
    assert.equal(
      events.find((event) => event.type === 'error')?.error?.kind,
      kind,
    );
    assert.equal(events.at(-1)?.success, false);
  }
  assert.equal(
    decodeCodexEvent({ type: 'error' }).find((event) => event.type === 'error')
      ?.error?.kind,
    'protocol',
  );
  const denied = decodeCodexEvent({
    type: 'item.completed',
    item: {
      type: 'command_execution',
      status: 'failed',
      exit_code: 1,
      aggregated_output: 'Operation not permitted',
    },
  });
  assert.ok(denied.some((event) => event.type === 'permission'));
  const recoverable = decodeCodexEvent({
    type: 'item.completed',
    item: {
      type: 'command_execution',
      status: 'completed',
      exit_code: 1,
      aggregated_output: 'Tests failed',
    },
  });
  assert.deepEqual(
    recoverable.map((event) => event.type),
    ['tool'],
  );
});

test('Codex probe is bounded and reports unsupported interactive operations', async () => {
  const capabilities = await provider.probe();
  assert.equal(capabilities.version, '0.163.0');
  assert.equal(capabilities.structured_events.status, 'supported');
  assert.equal(capabilities.native_resume.status, 'supported');
  assert.equal(capabilities.mid_turn_input.status, 'unsupported');
  assert.equal(capabilities.permission_requests.status, 'unsupported');
  await assert.rejects(
    new CodexProvider('/nonexistent/avity-crew-codex').probe(),
    { code: 'PROVIDER_UNAVAILABLE' },
  );
});

test('Codex passes prompt on stdin, preserves argv, model, permissions and bridge env', async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'avity codex offline '));
  try {
    const input = {
      scenario: 'capture',
      id: first,
      message: 'line one\n`literal` $(literal) "quoted"',
    };
    const req = request(input, cwd);
    req.model = 'accessible-model';
    req.bridge = {
      command: process.execPath,
      args: ['bridge with spaces.mjs'],
      env: { AVITY_CREW_BRIDGE_TOKEN: 'sensitive-test-sentinel' },
    };
    const { result } = await collect(provider.start(req));
    assert.equal(result.success, true);
    const capture = JSON.parse(result.text) as {
      args: string[];
      prompt: string;
      cwd: string;
      token_present: boolean;
    };
    assert.equal(capture.prompt, JSON.stringify(input));
    assert.equal(capture.cwd, await realpath(cwd));
    assert.equal(capture.token_present, true);
    assert.deepEqual(capture.args.slice(-3), [
      '-c',
      'mcp_servers.crew.required=true',
      '-',
    ]);
    assert.ok(capture.args.includes('sandbox_mode="workspace-write"'));
    assert.ok(capture.args.includes('approval_policy="never"'));
    assert.ok(capture.args.includes('accessible-model'));
    assert.ok(
      capture.args.includes(
        'mcp_servers.crew.env_vars=["AVITY_CREW_BRIDGE_TOKEN"]',
      ),
    );
    assert.ok(!capture.args.join(' ').includes('sensitive-test-sentinel'));
    assert.ok(!capture.args.includes('--last'));
    const leaked = await collect(
      provider.start({
        ...req,
        prompt: JSON.stringify({ scenario: 'leak', id: first }),
      }),
    );
    assert.ok(!JSON.stringify(leaked).includes('sensitive-test-sentinel'));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('Codex sessions remain isolated and resume only the requested UUID with new input', async () => {
  const [a, b] = await Promise.all([
    collect(
      provider.start(
        request({ scenario: 'fragmented', id: first, message: 'é🚀 first' }),
      ),
    ),
    collect(provider.start(request({ id: second, message: 'second' }))),
  ]);
  assert.equal(a.result.native_session_id, first);
  assert.equal(a.result.text, 'é🚀 first');
  assert.equal(b.result.native_session_id, second);
  assert.equal(b.result.text, 'second');
  const resumed = await collect(
    provider.resume({
      ...request({ scenario: 'capture', message: 'new note' }),
      native_session_id: first,
    }),
  );
  assert.equal(resumed.result.native_session_id, first);
  const args = (JSON.parse(resumed.result.text) as { args: string[] }).args;
  assert.equal(args[1], 'resume');
  assert.deepEqual(args.slice(-2), [first, '-']);
  assert.ok(!args.includes('--sandbox'));
  for (const id of ['', '--last', 'some session', second + ' -'])
    assert.throws(
      () => provider.resume({ ...request({}), native_session_id: id }),
      { code: 'INVALID_INPUT' },
    );
});

test('Codex process rejects truncation, errors, bad exits and unsupported updates', async () => {
  for (const scenario of ['truncated', 'failure', 'bad-exit']) {
    const { result } = await collect(
      provider.start(
        request({ scenario, id: first, message: 'Usage limit reached' }),
      ),
    );
    assert.equal(result.success, false, scenario);
    assert.ok(result.error, scenario);
  }
  const unknown = await collect(
    provider.start(
      request({ scenario: 'unknown', id: first, message: 'done' }),
    ),
  );
  assert.equal(unknown.result.success, true);
  assert.ok(unknown.events.some((event) => event.type === 'unknown'));
  const run = provider.start(request({ scenario: 'wait', id: first }));
  await assert.rejects(run.send('new note'), { code: 'UNSUPPORTED' });
  const consuming = (async () => {
    for await (const event of run.events)
      if (event.type === 'session') await run.interrupt();
  })();
  const result = await run.result;
  await consuming;
  assert.equal(result.success, false);
  assert.equal(result.native_session_id, first);
});
