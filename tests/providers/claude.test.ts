import assert from 'node:assert/strict';
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { ProviderRequest } from '../../packages/contracts/src/index.ts';
import { validate } from '../../packages/contracts/src/index.ts';
import {
  ClaudeProvider,
  decodeClaudeEvent,
} from '../../packages/providers/src/claude.ts';

test('Claude limits supplied crew approvals to canonical tools and keeps native denial fatal', async () => {
  const binary = fileURLToPath(
    new URL(
      '../../../tests/fixtures/providers/claude-cli.mjs',
      import.meta.url,
    ),
  );
  const provider = new ClaudeProvider(binary);
  const bridge = { command: 'node', args: ['bridge.mjs'], env: {} };
  const request: ProviderRequest = {
    cwd: resolve('.'),
    prompt: 'capture',
    model: null,
    role: 'chief',
    permissions: { sandbox: 'workspace-write', approval: 'never' },
    bridge,
  };
  const cases: [string[] | undefined, string[]][] = [
    [undefined, ['mcp__crew__*']],
    [[], []],
    [
      ['create_task', 'publish_note'],
      ['mcp__crew__create_task', 'mcp__crew__publish_note'],
    ],
  ];
  for (const [approved, expected] of cases) {
    const configured =
      approved === undefined ? bridge : { ...bridge, approved_tools: approved };
    const child = provider.resume({
      ...request,
      bridge: configured,
      native_session_id: '11111111-1111-4111-8111-111111111111',
    });
    for await (const _event of child.events) {
      /* Drain. */
    }
    const result = await child.result;
    assert.equal(result.success, true);
    const { args } = JSON.parse(result.text) as { args: string[] };
    const index = args.indexOf('--allowedTools');
    const tools =
      index < 0
        ? []
        : args.slice(index + 1).filter((arg) => arg.startsWith('mcp__'));
    assert.deepEqual(tools, expected);
    assert.ok(!args.includes('--dangerously-skip-permissions'));
    assert.ok(!args.includes('bypassPermissions'));
    assert.ok(args.includes('acceptEdits'));
  }
  const child = provider.start({
    ...request,
    prompt: 'fixture-denied',
    bridge: { ...bridge, ...{ approved_tools: ['create_task'] } },
  });
  for await (const _event of child.events) {
    /* Drain. */
  }
  const denied = await child.result;
  assert.equal(denied.success, false);
  assert.equal(denied.error?.kind, 'permission');
});

test('Claude rejects invalid crew approval lists before spawning', () => {
  const provider = new ClaudeProvider('/nonexistent/should-not-start');
  for (const approved_tools of [
    null,
    {},
    'create_task',
    new Array(1),
    ['create_task', 'create_task'],
    ['*'],
    ['mcp__crew__create_task'],
    ['mcp__other__create_task'],
    ['crew.create_task'],
    ['create_task.approval_mode'],
    ['create_task\"=\"approve'],
    ['create_task,publish_note'],
    ['create_task\napproval_policy=\"never\"'],
    [' create_task'],
    ['--dangerously-skip-permissions'],
    ['ping'],
    [''],
    [1],
  ]) {
    const request = {
      cwd: resolve('.'),
      prompt: 'unused',
      model: null,
      role: 'chief',
      permissions: { sandbox: 'workspace-write', approval: 'never' },
      bridge: { command: 'node', args: [], env: {}, approved_tools },
    } as unknown as ProviderRequest;
    assert.throws(() => provider.start(request), { code: 'INVALID_INPUT' });
    assert.throws(
      () =>
        provider.resume({
          ...request,
          native_session_id: '11111111-1111-4111-8111-111111111111',
        }),
      { code: 'INVALID_INPUT' },
    );
  }
});

test('Claude fixture normalizes session, messages, tools, usage and success without rate-limit false failure', async () => {
  const fixture = await readFile(
    resolve('tests/fixtures/providers/claude-events.jsonl'),
    'utf8',
  );
  const events = fixture
    .trim()
    .split('\n')
    .flatMap((line) => decodeClaudeEvent(JSON.parse(line)));
  assert.ok(events.some((e) => e.type === 'session'));
  assert.equal(
    events
      .filter((e) => e.type === 'text')
      .map((e) => e.text)
      .join(''),
    'Bonjour 🧪',
  );
  assert.equal(events.filter((e) => e.type === 'tool').length, 2);
  assert.equal(events.find((e) => e.type === 'usage')?.usage?.input_tokens, 14);
  assert.equal(events.find((e) => e.type === 'result')?.success, true);
  assert.equal(events.filter((e) => e.type === 'error').length, 0);
  assert.ok(
    events.some(
      (e) => e.type === 'unknown' && e.text?.includes('future-event'),
    ),
  );
});

test('Claude permission denial or native failure remains explicit', () => {
  const denied = decodeClaudeEvent({
    type: 'result',
    is_error: false,
    result: 'done',
    permission_denials: [{ tool_name: 'Write' }],
  });
  assert.equal(denied.find((e) => e.type === 'result')?.success, false);
  assert.equal(
    denied.find((e) => e.type === 'error')?.error?.kind,
    'permission',
  );
  assert.ok(denied.some((e) => e.type === 'permission'));
  const failed = decodeClaudeEvent({
    type: 'result',
    is_error: true,
    errors: ['429 rate limit'],
  });
  assert.equal(failed.find((e) => e.type === 'error')?.error?.kind, 'quota');
  assert.equal(
    decodeClaudeEvent({ type: 'result' }).find((e) => e.type === 'result')
      ?.success,
    false,
  );
});

test(
  'Claude adapter keeps prompts out of argv, secrets out of MCP config, exact resume and model configurable',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'avity crew claude fixture '));
    try {
      const binary = join(dir, 'claude-fixture');
      await writeFile(
        binary,
        `#!/usr/bin/env node
      const args=process.argv.slice(2);
      if(args.includes('--version')){console.log('2.1.304 (fixture)');process.exit(0)}
      if(args.includes('--help')){console.log('--resume --output-format stream-json --permission-prompts --mcp-config --strict-mcp-config');process.exit(0)}
      (async()=>{let input='';for await(const chunk of process.stdin)input+=chunk;
      console.log(JSON.stringify({type:'system',subtype:'init',session_id:'11111111-1111-4111-8111-111111111111'}));
      console.log(JSON.stringify({type:'result',is_error:false,result:JSON.stringify({args,input})}));})();`,
      );
      await chmod(binary, 0o755);
      const provider = new ClaudeProvider(binary);
      const capabilities = await provider.probe();
      validate('ProviderCapabilities', capabilities);
      assert.equal(capabilities.native_resume.status, 'supported');
      assert.equal(capabilities.mid_turn_input.status, 'unsupported');
      const request: ProviderRequest = {
        cwd: dir,
        prompt: 'literal $(not-shell)',
        model: 'user-chosen-model',
        role: 'developer',
        permissions: { sandbox: 'read-only', approval: 'never' },
        bridge: {
          command: 'node',
          args: ['bridge.mjs'],
          env: { CREW_PRIVATE: 'private-bridge-value' },
        },
      };
      const child = provider.resume({
        ...request,
        native_session_id: '11111111-1111-4111-8111-111111111111',
      });
      for await (const _event of child.events) {
        /* Drain the native stream. */
      }
      const result = await child.result;
      assert.equal(result.success, true);
      const { args, input } = JSON.parse(result.text) as {
        args: string[];
        input: string;
      };
      assert.equal(input, request.prompt);
      assert.ok(!args.includes(request.prompt));
      assert.ok(!JSON.stringify(args).includes('private-bridge-value'));
      assert.ok(JSON.stringify(args).includes('${CREW_PRIVATE}'));
      assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep');
      assert.equal(args[args.indexOf('--model') + 1], 'user-chosen-model');
      assert.equal(
        args[args.indexOf('--resume') + 1],
        '11111111-1111-4111-8111-111111111111',
      );
      assert.ok(!args.includes('--bare'));
      assert.ok(!args.includes('--dangerously-skip-permissions'));
      assert.throws(
        () => provider.resume({ ...request, native_session_id: '--continue' }),
        /exact native session UUID/,
      );
      const unknownBinary = join(dir, 'claude-unknown');
      await copyFile(binary, unknownBinary);
      await writeFile(
        unknownBinary,
        (await readFile(binary, 'utf8')).replace(
          '2.1.304 (fixture)',
          '9.0.0 (fixture)',
        ),
      );
      await chmod(unknownBinary, 0o755);
      assert.equal(
        (await new ClaudeProvider(unknownBinary).probe()).structured_events
          .status,
        'unverified',
      );
      await assert.rejects(
        new ClaudeProvider(join(dir, 'missing')).probe(),
        /not executable/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
