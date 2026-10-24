import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexProvider } from '../dist/packages/providers/src/codex.js';

const [reportPath, mode = 'single'] = process.argv.slice(2);
assert.ok(
  reportPath && isAbsolute(reportPath),
  'Pass an absolute JSON report path',
);
assert.ok(
  ['single', 'parallel', 'permission'].includes(mode),
  'Mode must be single, parallel or permission',
);
const provider = new CodexProvider(
  process.env.AVITY_CREW_CODEX_BINARY || 'codex',
);
const cwd = await mkdtemp(resolve(tmpdir(), 'avity codex live '));
assert.equal(spawnSync('git', ['init', '--quiet', cwd]).status, 0);
const audit = resolve(cwd, 'mcp-audit.jsonl');
const token = randomUUID();
const marker = randomUUID();
const records = [];
const report = {
  mode,
  checked_at: new Date().toISOString(),
  source_revision: spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).stdout.trim(),
  requested_model: process.env.AVITY_CREW_CODEX_MODEL || null,
  effective_model: null,
  model_evidence: 'Exec JSONL does not expose the selected model',
  cwd,
  capabilities: await provider.probe(),
  records,
  success: false,
};
const request = (prompt, sandbox = 'workspace-write') => ({
  cwd,
  prompt: `Authorized disposable integration test. Work only in the current directory. Do not start other agents, browse, change settings, or use git.\n${prompt}`,
  model: process.env.AVITY_CREW_CODEX_MODEL || null,
  role: 'developer',
  permissions: { sandbox, approval: 'never' },
  bridge: {
    command: process.execPath,
    args: [
      fileURLToPath(
        new URL('../tests/fixtures/providers/mcp-ping.mjs', import.meta.url),
      ),
    ],
    env: { AVITY_CREW_MCP_AUDIT: audit, AVITY_CREW_BRIDGE_TOKEN: token },
  },
});
async function run(name, req, session, interrupt = false) {
  const native = session
    ? provider.resume({ ...req, native_session_id: session })
    : provider.start(req);
  const events = [];
  let interrupted = false;
  const cancel = async () => {
    if (!interrupted) {
      interrupted = true;
      await native.interrupt();
    }
  };
  const timeout = setTimeout(
    () => {
      void cancel();
    },
    interrupt ? 25_000 : 90_000,
  );
  const consuming = (async () => {
    for await (const event of native.events) {
      events.push(event);
      if (interrupt && event.type === 'tool' && event.text?.includes('sleep'))
        await cancel();
    }
  })();
  try {
    const result = await native.result;
    await consuming;
    const record = {
      name,
      permissions: req.permissions,
      interrupted,
      result,
      events,
    };
    records.push(record);
    return record;
  } finally {
    clearTimeout(timeout);
  }
}
async function verifyPermission() {
  const denied = await run(
    'permission-read-only',
    request(
      "This test requires observing the native sandbox boundary. Use the shell tool once to execute exactly: printf 'DENIED\\n' > denied.txt . Do not substitute an explanation before trying the command. If refused, report the refusal and do not retry, request escalation, or change permissions.",
      'read-only',
    ),
  );
  await assert.rejects(access(resolve(cwd, 'denied.txt')));
  assert.ok(
    denied.events.some((event) => event.type === 'tool'),
    'A native tool attempt must be observed',
  );
  assert.ok(
    denied.events.some(
      (event) =>
        event.type === 'permission' || event.error?.kind === 'permission',
    ),
    'Native refusal must be normalized',
  );
  assert.equal(denied.result.success, false);
}
try {
  if (mode === 'single') {
    const first = await run(
      'edit-and-mcp',
      request(
        `Call crew.ping with message L05_FIRST, then create proof.txt with exactly ONE_${marker} followed by a newline. Use a real file tool. Reply DONE.`,
      ),
    );
    assert.equal(first.result.success, true);
    assert.ok(first.result.native_session_id);
    assert.equal(
      await readFile(resolve(cwd, 'proof.txt'), 'utf8'),
      `ONE_${marker}\n`,
    );
    const auditText = await readFile(audit, 'utf8');
    assert.match(auditText, /tools\/call/);
    assert.match(auditText, /ping/);
    const resumed = await run(
      'resume-new-note',
      request(
        `New team note: append TWO_${marker} and a newline to proof.txt. Preserve its existing line. Reply DONE.`,
      ),
      first.result.native_session_id,
    );
    assert.equal(resumed.result.success, true);
    assert.equal(
      resumed.result.native_session_id,
      first.result.native_session_id,
    );
    assert.equal(
      await readFile(resolve(cwd, 'proof.txt'), 'utf8'),
      `ONE_${marker}\nTWO_${marker}\n`,
    );
    const interrupted = await run(
      'interrupt',
      request(
        'Run a command that sleeps for 30 seconds and only afterwards creates interrupted.txt. Do not create the file before the sleep.',
      ),
      undefined,
      true,
    );
    assert.equal(interrupted.interrupted, true);
    assert.equal(interrupted.result.success, false);
    assert.ok(interrupted.result.native_session_id);
    await assert.rejects(access(resolve(cwd, 'interrupted.txt')));
    const recovered = await run(
      'resume-interrupted',
      request(
        'The prior sleep was cancelled. Do not repeat it. Create recovered.txt containing RECOVERED and a newline, then reply DONE.',
      ),
      interrupted.result.native_session_id,
    );
    assert.equal(recovered.result.success, true);
    assert.equal(
      recovered.result.native_session_id,
      interrupted.result.native_session_id,
    );
    assert.equal(
      await readFile(resolve(cwd, 'recovered.txt'), 'utf8'),
      'RECOVERED\n',
    );
    await verifyPermission();
  } else if (mode === 'permission') {
    await verifyPermission();
  } else {
    const [a, b] = await Promise.all([
      run(
        'parallel-a',
        request(
          `Remember private note ALPHA_${marker}. Reply exactly ALPHA_${marker}. Use no tools.`,
        ),
      ),
      run(
        'parallel-b',
        request(
          `Remember private note BETA_${marker}. Reply exactly BETA_${marker}. Use no tools.`,
        ),
      ),
    ]);
    assert.equal(a.result.success, true);
    assert.equal(b.result.success, true);
    assert.notEqual(a.result.native_session_id, b.result.native_session_id);
    const [ar, br] = await Promise.all([
      run(
        'parallel-resume-a',
        request(
          'New note DELTA_A. Reply with the previous private note and DELTA_A only. Use no tools.',
        ),
        a.result.native_session_id,
      ),
      run(
        'parallel-resume-b',
        request(
          'New note DELTA_B. Reply with the previous private note and DELTA_B only. Use no tools.',
        ),
        b.result.native_session_id,
      ),
    ]);
    assert.match(ar.result.text, new RegExp(`ALPHA_${marker}.*DELTA_A`, 's'));
    assert.doesNotMatch(ar.result.text, /BETA_|DELTA_B/);
    assert.match(br.result.text, new RegExp(`BETA_${marker}.*DELTA_B`, 's'));
    assert.doesNotMatch(br.result.text, /ALPHA_|DELTA_A/);
    assert.equal(ar.result.native_session_id, a.result.native_session_id);
    assert.equal(br.result.native_session_id, b.result.native_session_id);
  }
  report.success = true;
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  const serialized = JSON.stringify(report, null, 2);
  assert.ok(
    !serialized.includes(token),
    'Bridge capability must not enter the report',
  );
  await writeFile(reportPath, `${serialized}\n`, { mode: 0o600 });
  console.log(
    `${report.success ? 'PASS' : 'FAIL'} ${mode}: ${records.length} native turns; report ${reportPath}`,
  );
}
