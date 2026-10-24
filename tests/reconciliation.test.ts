import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { TestContext } from 'node:test';
import {
  observeProcess,
  stopOwnedProcess,
} from '../packages/supervisor/src/reconciliation.ts';

const posix = { skip: process.platform === 'win32' };
const fixture = fileURLToPath(
  new URL('../../tests/fixtures/supervisor/process-tree.mjs', import.meta.url),
);
const reconciliation = { code: 'RECONCILIATION_REQUIRED' };

async function waitFor<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
): Promise<T> {
  const until = performance.now() + 2000;
  while (true) {
    try {
      const value = await read();
      if (ready(value)) return value;
    } catch {
      /* Wait for the fixture's first write. */
    }
    if (performance.now() >= until)
      throw new Error('Laboratory did not become ready');
    await delay(20);
  }
}

async function laboratory(t: TestContext, mode = 'single', detached = true) {
  const directory = await mkdtemp(join(tmpdir(), 'avity process identity '));
  const child = spawn(
    process.execPath,
    [
      fixture,
      mode,
      directory,
      'private-argv-sentinel',
      new URL('../packages/supervisor/src/reconciliation.js', import.meta.url)
        .href,
    ],
    { detached, stdio: 'ignore' },
  );
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
  t.after(async () => {
    let leafPid: number | undefined;
    try {
      leafPid = Number(await readFile(join(directory, 'child-pid'), 'utf8'));
    } catch {
      /* Single process. */
    }
    try {
      process.kill(detached ? -child.pid! : child.pid!, 'SIGKILL');
    } catch {
      /* Already dead. */
    }
    await exited;
    if (leafPid)
      await waitFor(
        () => observeProcess(leafPid!),
        (identity) => identity === null,
      );
    await rm(directory, { recursive: true, force: true });
  });
  const beat = () => readFile(join(directory, 'beat'), 'utf8');
  await waitFor(beat, (value) => value.length > 0);
  return { directory, child, exited, beat };
}

test(
  'a recorded native identity resumes the same PID, hashes argv, and observes completed shutdown',
  posix,
  async (t) => {
    const lab = await laboratory(t);
    const identity = await observeProcess(lab.child.pid!);
    assert.ok(identity);
    assert.equal(identity.pid, lab.child.pid);
    assert.equal(identity.group_id, identity.pid);
    assert.match(identity.command_sha256, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(identity).includes('private-argv-sentinel'));
    const repeated = await observeProcess(identity.pid);
    assert.equal(repeated?.started_at, identity.started_at);
    assert.equal(repeated?.command_sha256, identity.command_sha256);
    assert.equal(
      await stopOwnedProcess(JSON.parse(JSON.stringify(identity))),
      'stopped',
    );
    await lab.exited;
    assert.equal(await observeProcess(identity.pid), null);
    assert.equal(await stopOwnedProcess(identity), 'already_exited');
  },
);

test(
  'forged identity and non-owned groups are refused before signaling either laboratory',
  posix,
  async (t) => {
    const own = await laboratory(t),
      foreign = await laboratory(t),
      shared = await laboratory(t, 'single', false);
    const identity = await observeProcess(own.child.pid!),
      sharedIdentity = await observeProcess(shared.child.pid!);
    assert.ok(identity && sharedIdentity);
    assert.notEqual(sharedIdentity.group_id, sharedIdentity.pid);
    for (const forged of [
      { ...identity, command_sha256: '0'.repeat(64) },
      { ...identity, started_at: '2000-01-01T00:00:00.000Z' },
      { ...identity, pid: foreign.child.pid!, group_id: foreign.child.pid! },
      { ...identity, group_id: null },
      sharedIdentity,
    ])
      await assert.rejects(stopOwnedProcess(forged), reconciliation);
    const before = await Promise.all([
      own.beat(),
      foreign.beat(),
      shared.beat(),
    ]);
    await delay(100);
    const after = await Promise.all([
      own.beat(),
      foreign.beat(),
      shared.beat(),
    ]);
    assert.ok(
      after.every((value, index) => value.length > before[index]!.length),
    );
  },
);

for (const mode of ['tree-exit', 'tree-ignore'])
  test(
    `shutdown observes surviving descendants after ${mode} parent termination`,
    posix,
    async (t) => {
      const lab = await laboratory(t, mode);
      const leaf = () => readFile(join(lab.directory, 'leaf-beat'), 'utf8');
      await waitFor(leaf, (value) => value.length > 0);
      const identity = await observeProcess(lab.child.pid!);
      assert.ok(identity);
      const started = performance.now();
      assert.equal(await stopOwnedProcess(identity), 'stopped');
      assert.ok(performance.now() - started < 3000);
      await lab.exited;
      const stopped = await leaf();
      await delay(150);
      assert.equal(
        await leaf(),
        stopped,
        'no orphan writes after shutdown returns',
      );
    },
  );

test(
  'a missing leader with a live orphan requires reconciliation, not an already-exited claim',
  posix,
  async (t) => {
    const lab = await laboratory(t, 'tree-exit');
    const leaf = () => readFile(join(lab.directory, 'leaf-beat'), 'utf8');
    await waitFor(leaf, (value) => value.length > 0);
    const identity = await observeProcess(lab.child.pid!);
    assert.ok(identity);
    process.kill(identity.pid, 'SIGTERM');
    await lab.exited;
    assert.equal(await observeProcess(identity.pid), null);
    await assert.rejects(stopOwnedProcess(identity), {
      ...reconciliation,
      message: /leader has exited/,
    });
    const before = await leaf();
    await delay(80);
    assert.ok(
      (await leaf()).length > before.length,
      'the unverified orphan was not signaled',
    );
  },
);

test(
  'the reconciling caller never signals its own process group leader',
  posix,
  async (t) => {
    const lab = await laboratory(t, 'same-group-probe');
    assert.equal(
      await waitFor(
        () => readFile(join(lab.directory, 'probe'), 'utf8'),
        Boolean,
      ),
      'RECONCILIATION_REQUIRED',
    );
    const before = await lab.beat();
    await delay(80);
    assert.ok((await lab.beat()).length > before.length);
  },
);

test(
  'zombies are observed as dead and do not keep an owned group running',
  posix,
  async (t) => {
    const lab = await laboratory(t, 'zombie-holder');
    const leafPid = Number(
      await readFile(join(lab.directory, 'child-pid'), 'utf8'),
    );
    await waitFor(
      async () => {
        const state = spawnSync(
          '/bin/ps',
          ['-p', String(leafPid), '-o', 'stat='],
          { encoding: 'utf8', timeout: 350 },
        );
        return state.stdout.trim();
      },
      (state) => state.startsWith('Z'),
    );
    assert.equal(await observeProcess(leafPid), null);
    const identity = await observeProcess(lab.child.pid!);
    assert.ok(identity);
    assert.equal(await stopOwnedProcess(identity), 'stopped');
  },
);

test(
  'invalid PIDs and native inspection failures stay explicit without raw commands',
  posix,
  async () => {
    for (const pid of [0, -1, 1.2, Number.NaN, Number.MAX_SAFE_INTEGER])
      await assert.rejects(observeProcess(pid), reconciliation);
    const module = new URL(
      '../packages/supervisor/src/reconciliation.js',
      import.meta.url,
    ).href;
    const code = `import { observeProcess } from ${JSON.stringify(module)};try { await observeProcess(process.pid); process.exitCode=2; } catch(error) { console.log(JSON.stringify({code:error.code,message:error.message})); }`;
    const result = spawnSync(
      process.execPath,
      ['--permission', '--allow-fs-read=*', '--input-type=module', '-e', code],
      { encoding: 'utf8', timeout: 3000 },
    );
    assert.equal(result.status, 0);
    const error = JSON.parse(result.stdout) as {
      code: string;
      message: string;
    };
    assert.equal(error.code, 'RECONCILIATION_REQUIRED');
    assert.ok(!error.message.includes('--input-type'));
    assert.ok(!error.message.includes(code));
  },
);
