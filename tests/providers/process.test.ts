import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import type {
  ProviderEvent,
  ProviderProcess,
  ProviderRequest,
} from '../../packages/contracts/src/index.ts';
import {
  classifyNativeError,
  executable,
  runNative,
  validateProviderRequest,
} from '../../packages/providers/src/process.ts';

const request = (cwd = tmpdir()): ProviderRequest => ({
  cwd,
  prompt: 'literal $(never execute); é🧪',
  model: null,
  role: 'developer',
  permissions: { sandbox: 'read-only', approval: 'never' },
});
const decode = (event: unknown): ProviderEvent[] => [event as ProviderEvent];
const emit = `const emit = e => process.stdout.write(JSON.stringify(e)+'\\n');`;
async function collect(process: ProviderProcess): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of process.events) events.push(event);
  return events;
}

test('native requests reject malformed runtime input before process launch', () => {
  for (const invalid of [
    null,
    { ...request(), cwd: '.' },
    { ...request(), prompt: '' },
    { ...request(), model: {} },
    {
      ...request(),
      permissions: { sandbox: 'danger-full-access', approval: 'never' },
    },
    {
      ...request(),
      bridge: { command: 'node', args: [], env: { TOKEN: 123 } },
    },
  ])
    assert.throws(
      () => validateProviderRequest(invalid as ProviderRequest),
      /Invalid native provider request/,
    );
  assert.doesNotThrow(() => validateProviderRequest(request()));
});

test('private bridge settings do not corrupt native identities and stay redacted in text', async () => {
  const child = runNative(
    'codex',
    process.execPath,
    [
      '-e',
      `${emit} emit({type:'session',native_session_id:'session-1'});emit({type:'text',text:'port=1 capability='+process.env.AVITY_CREW_CAPABILITY});emit({type:'result',success:true});`,
    ],
    {
      ...request(),
      bridge: {
        command: process.execPath,
        args: [],
        env: {
          AVITY_CREW_PORT: '1',
          AVITY_CREW_CAPABILITY: 'private-capability-sentinel',
        },
      },
    },
    decode,
  );
  const events = await collect(child);
  const result = await child.result;
  assert.equal(result.native_session_id, 'session-1');
  assert.equal(result.text, 'port=[REDACTED] capability=[REDACTED]');
  assert.ok(events.every((event) => event.native_session_id === 'session-1'));
  assert.doesNotMatch(JSON.stringify(events), /private-capability-sentinel/);
});

test('opaque bridge environment values are private even without a credential-like key name', async () => {
  const child = runNative(
    'codex',
    process.execPath,
    [
      '-e',
      `${emit} emit({type:'session',native_session_id:'opaque-session'});emit({type:'text',text:process.env.CREW_HANDLE});emit({type:'result',success:true});`,
    ],
    {
      ...request(),
      bridge: {
        command: process.execPath,
        args: [],
        env: { CREW_HANDLE: 'opaque-bridge-sentinel' },
      },
    },
    decode,
  );
  const events = await collect(child);
  const result = await child.result;
  assert.equal(result.native_session_id, 'opaque-session');
  assert.equal(result.text, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(events), /opaque-bridge-sentinel/);
});

test('native JSONL preserves UTF-8 fragments, stdin and unknown diagnostics', async () => {
  const source = `${emit}
    let input=''; for await (const chunk of process.stdin) input+=chunk;
    emit({type:'session',native_session_id:'session-one'});
    const bytes=Buffer.from(JSON.stringify({type:'text',text:input})+'\\n');
    for(let i=0;i<bytes.length;i++) { process.stdout.write(bytes.subarray(i,i+1)); await new Promise(r=>setTimeout(r,1)); }
    emit({type:'unknown',text:'future-event'});
    process.stdout.write(JSON.stringify({type:'result',success:true}));`;
  const child = runNative(
    'claude',
    process.execPath,
    ['-e', source],
    request(),
    decode,
  );
  const events = await collect(child);
  const result = await child.result;
  assert.equal(result.success, true);
  assert.equal(result.text, request().prompt);
  assert.equal(result.native_session_id, 'session-one');
  assert.equal(events.find((e) => e.type === 'unknown')?.text, 'future-event');
  assert.ok(events.every((e) => e.native_session_id === 'session-one'));
  assert.ok(events.every((e) => e.provenance === 'live'));
  await assert.rejects(child.send('update'), /unsupported/);
});

test('simulated simultaneous native sessions keep their prompts and identities separate', async () => {
  const children = ['one', 'two'].map((name) =>
    runNative(
      'claude',
      process.execPath,
      [
        '-e',
        `${emit} emit({type:'session',native_session_id:'${name}'});let input='';for await(const chunk of process.stdin)input+=chunk;emit({type:'text',text:input});emit({type:'result',success:true});`,
      ],
      { ...request(), prompt: name },
      decode,
    ),
  );
  const results = await Promise.all(
    children.map(async (child) => {
      await collect(child);
      return child.result;
    }),
  );
  assert.deepEqual(
    results.map((result) => [
      result.native_session_id,
      result.text,
      result.success,
    ]),
    [
      ['one', 'one', true],
      ['two', 'two', true],
    ],
  );
});

test('native backpressure retains every event for a slow consumer', async () => {
  const source = `${emit} for(let i=0;i<700;i++)emit({type:'text',text:'x'});emit({type:'result',success:true});`;
  const child = runNative(
    'codex',
    process.execPath,
    ['-e', source],
    request(),
    decode,
  );
  const events: ProviderEvent[] = [];
  for await (const event of child.events) {
    events.push(event);
    if (events.length % 100 === 0) await delay(2);
  }
  assert.equal(events.filter((e) => e.type === 'text').length, 700);
  assert.equal((await child.result).text.length, 700);
  assert.equal((await child.result).success, true);
});

test('provider errors and secrets never become a successful or raw result', async () => {
  const req = {
    ...request(),
    bridge: {
      command: 'node',
      args: [],
      env: { AVITY_CREW_BRIDGE_TOKEN: 'private-sentinel-123' },
    },
  };
  const source = `${emit} emit({type:'text',text:process.env.AVITY_CREW_BRIDGE_TOKEN}); emit({type:'error',error:{kind:'authentication',message:'Bearer abcdefghijklmnop '+process.env.AVITY_CREW_BRIDGE_TOKEN}});emit({type:'result',success:true});process.stderr.write('token sk-example123456789');`;
  const child = runNative(
    'claude',
    process.execPath,
    ['-e', source],
    req,
    decode,
  );
  const events = await collect(child);
  const result = await child.result;
  assert.equal(result.success, false);
  const serialized = JSON.stringify({ events, result });
  assert.ok(!serialized.includes('private-sentinel-123'));
  assert.ok(!serialized.includes('abcdefghijklmnop'));
  assert.ok(!serialized.includes('sk-example123456789'));
  assert.ok(serialized.includes('[REDACTED]'));
});

test('missing binaries, missing terminal result and nonzero exit fail explicitly', async () => {
  for (const [binary, args, kind] of [
    ['/avity-crew/no-such-binary', [], 'process'],
    [process.execPath, ['-e', 'process.stdin.resume()'], 'protocol'],
    [
      process.execPath,
      [
        '-e',
        `${emit} emit({type:'result',success:true});process.stderr.write('Authentication failed: login required');process.exitCode=1;`,
      ],
      'authentication',
    ],
  ] as const) {
    const child = runNative('claude', binary, args, request(), decode);
    await collect(child);
    const result = await child.result;
    assert.equal(result.success, false);
    assert.equal(result.error?.kind, kind);
  }
});

test('malformed or oversized JSONL and changed session identity fail closed', async () => {
  for (const source of [
    `process.stdout.write('not-json\\n');`,
    `process.stdout.write('x'.repeat(1024*1024+1));`,
    `process.stdout.write(JSON.stringify({type:'unknown',text:'é'.repeat(600*1024)})+'\\n');`,
    `${emit} emit({type:'session',native_session_id:'one'});emit({type:'session',native_session_id:'two'});emit({type:'result',success:true});`,
  ]) {
    const child = runNative(
      'codex',
      process.execPath,
      ['-e', source],
      request(),
      decode,
    );
    await collect(child);
    const result = await child.result;
    assert.equal(result.success, false);
    assert.equal(result.error?.kind, 'protocol');
  }
});

test('exact native resume rejects a different reported session', async () => {
  const req = { ...request(), native_session_id: 'expected' };
  const child = runNative(
    'claude',
    process.execPath,
    [
      '-e',
      `${emit} emit({type:'session',native_session_id:'wrong'});emit({type:'result',success:true});`,
    ],
    req,
    decode,
  );
  await collect(child);
  assert.equal((await child.result).error?.kind, 'protocol');
});

test(
  'interruption cannot expose an earlier native success and stops POSIX children',
  { skip: process.platform === 'win32' },
  async () => {
    const temp = await mkdtemp(join(tmpdir(), 'avity-crew-process-'));
    try {
      const source = `${emit}
      const cp=require('node:child_process');
      const grandchild=cp.spawn(process.execPath,['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
      emit({type:'text',text:String(grandchild.pid)});
      emit({type:'result',success:true});
      process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
      const child = runNative(
        'claude',
        process.execPath,
        ['-e', source],
        request(temp),
        decode,
      );
      let descendant = 0;
      let markReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        markReady = resolve;
      });
      const collected = (async () => {
        for await (const event of child.events) {
          if (event.type === 'text') {
            descendant = Number(event.text);
            markReady();
          }
        }
      })();
      await ready;
      let settled = false;
      void child.result.then(() => {
        settled = true;
      });
      await delay(30);
      assert.equal(settled, false);
      await child.interrupt();
      await collected;
      assert.equal((await child.result).success, false);
      assert.notEqual((await child.result).signal, null);
      assert.throws(() => process.kill(descendant, 0), /ESRCH/);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
);

test('native error classification distinguishes actionable failures', () => {
  for (const [message, kind] of [
    ['429 rate limit', 'quota'],
    ['not logged in', 'authentication'],
    ['permission denied', 'permission'],
    ['Operation not permitted', 'permission'],
    ['ECONNRESET', 'network'],
    ['unexpected exit', 'process'],
  ])
    assert.equal(classifyNativeError(message!).kind, kind);
});

test('provider binaries resolve from absolute PATH entries only, so probe and launch agree', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'avity provider path '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const installed = join(directory, 'installed'),
    decoy = join(directory, 'workspace');
  for (const folder of [installed, decoy]) {
    await mkdir(folder);
    await writeFile(join(folder, 'codex'), '#!/bin/sh\nexit 0\n', {
      mode: 0o755,
    });
  }
  const saved = process.env.PATH;
  t.after(() => {
    process.env.PATH = saved;
  });
  // Empty and relative entries depend on the searching process's directory.
  const relativeDecoy = relative(process.cwd(), decoy);
  process.env.PATH = ['', relativeDecoy, installed, ''].join(delimiter);
  assert.equal(executable('codex'), join(installed, 'codex'));
  process.env.PATH = ['', relativeDecoy].join(delimiter);
  assert.equal(executable('codex'), null);
  assert.equal(executable(join(decoy, 'codex')), join(decoy, 'codex'));
});
