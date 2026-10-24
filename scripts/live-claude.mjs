// Explicit local live test: consumes the user's native Claude Code subscription.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ClaudeProvider,
  decodeClaudeEvent,
} from '../dist/packages/providers/src/claude.js';
import { runNative } from '../dist/packages/providers/src/process.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? 'claude-live-report.json');
const workspace = await mkdtemp(join(tmpdir(), 'avity crew L04 live '));
const secret = randomUUID();
const provider = new ClaudeProvider();
const report = {
  schema_version: 1,
  lot: 'L04',
  evidence_level: 'live',
  started_at: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  workspace,
  scenarios: [],
  status: 'running',
};
const request = (prompt, writable = false) => ({
  cwd: workspace,
  prompt,
  model: null,
  role: 'developer',
  permissions: {
    sandbox: writable ? 'workspace-write' : 'read-only',
    approval: 'never',
  },
});
async function turn(name, child, verify, interrupt = false) {
  const events = [];
  let timeout = false;
  let stopRequested = false;
  const timer = setTimeout(() => {
    timeout = true;
    void child.stop();
  }, 90_000);
  let result;
  try {
    const reading = (async () => {
      for await (const event of child.events) {
        events.push(event);
        if (interrupt && !stopRequested && event.type === 'session') {
          stopRequested = true;
          await delay(250);
          void child.interrupt();
        }
      }
    })();
    [result] = await Promise.all([child.result, reading]);
    assert.equal(timeout, false, 'live turn timed out');
    await verify(result, events);
    report.scenarios.push({
      name,
      status: 'passed',
      result,
      event_types: events.map((e) => e.type),
    });
    console.log(
      JSON.stringify({
        name,
        status: 'passed',
        session: result.native_session_id,
        exit_code: result.exit_code,
      }),
    );
    return result;
  } catch (failure) {
    report.scenarios.push({
      name,
      status: 'failed',
      result,
      event_types: events.map((e) => e.type),
      error: String(failure),
    });
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

try {
  report.capabilities = await provider.probe();
  const audit = join(workspace, 'mcp-audit.jsonl');
  const first = await turn(
    'real-file-edit-and-mcp',
    provider.start({
      ...request(
        'Mission de recette jetable L04. Ne délègue pas. Avec Write, crée greeting.txt contenant exactement AVITY_CREW_L04 suivi dun saut de ligne. Appelle ensuite loutil MCP crew ping avec message L04_REAL_PING. Retiens la note CREW_L04_MEMORY pour le prochain tour. Aucun shell, réseau ni autre fichier. Réponds avec la confirmation des deux opérations.',
        true,
      ),
      bridge: {
        command: process.execPath,
        args: [join(root, 'tests/fixtures/providers/mcp-ping.mjs')],
        env: { AVITY_CREW_MCP_AUDIT: audit, AVITY_CREW_BRIDGE_TOKEN: secret },
      },
    }),
    async (result, events) => {
      assert.equal(result.success, true);
      assert.equal(
        await readFile(join(workspace, 'greeting.txt'), 'utf8'),
        'AVITY_CREW_L04\n',
      );
      const calls = (await readFile(audit, 'utf8'))
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert.ok(
        calls.some(
          (call) => call.method === 'tools/call' && call.tool === 'ping',
        ),
      );
      const toolResults = events
        .filter((e) => e.type === 'tool')
        .map((e) => {
          try {
            const block = JSON.parse(e.text);
            return block.type === 'tool_result'
              ? JSON.stringify(block.content).replaceAll('\\', '')
              : '';
          } catch {
            return '';
          }
        })
        .join('\n');
      assert.match(toolResults, /"token_present":true/);
      report.mcp_calls = calls;
    },
  );
  assert.ok(first.native_session_id);
  const resumed = await turn(
    'exact-resume-new-note-and-edit',
    provider.resume({
      ...request(
        'Nouvelle note déquipe DELTA_L04. Ajoute exactement DELTA_L04 suivi dun saut de ligne à greeting.txt en conservant sa première ligne. Réponds aussi avec la note que tu devais retenir au tour précédent. Aucun shell ni outil MCP nécessaire.',
        true,
      ),
      native_session_id: first.native_session_id,
    }),
    async (result) => {
      assert.equal(result.success, true);
      assert.equal(result.native_session_id, first.native_session_id);
      assert.equal(
        await readFile(join(workspace, 'greeting.txt'), 'utf8'),
        'AVITY_CREW_L04\nDELTA_L04\n',
      );
      assert.match(result.text, /CREW_L04_MEMORY/);
    },
  );
  assert.equal(resumed.native_session_id, first.native_session_id);
  const independent = await turn(
    'independent-native-session',
    provider.start(
      request('Réponds uniquement SECOND_SESSION_L04. Aucun outil.'),
    ),
    async (result) => {
      assert.equal(result.success, true);
      assert.notEqual(result.native_session_id, first.native_session_id);
      assert.match(result.text, /SECOND_SESSION_L04/);
    },
  );
  assert.ok(independent.native_session_id);
  await turn(
    'read-only-tool-boundary',
    provider.start(
      request(
        'Essaie de créer forbidden.txt contenant FORBIDDEN avec Write. Si loutil est indisponible, indique le refus et ne contourne pas la limite. Aucun autre outil.',
      ),
    ),
    async (_result, events) => {
      await assert.rejects(readFile(join(workspace, 'forbidden.txt')));
      assert.ok(events.some((e) => e.type === 'text'));
    },
  );
  const denyRequest = request(
    'Utilise impérativement Bash pour exécuter exactement printf L04_PERMISSION > permission-control.txt. Si la permission est refusée, signale le refus et termine sans autre outil.',
  );
  await turn(
    'controlled-native-permission-denial',
    runNative(
      'claude',
      'claude',
      [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--restricted',
        '--tools',
        'Bash',
        '--permission-mode',
        'dontAsk',
        '--permission-prompts',
        'none',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
      ],
      denyRequest,
      decodeClaudeEvent,
    ),
    async (result, events) => {
      assert.equal(result.success, false);
      assert.equal(result.error?.kind, 'permission');
      assert.ok(events.some((e) => e.type === 'permission'));
      await assert.rejects(readFile(join(workspace, 'permission-control.txt')));
    },
  );
  await turn(
    'live-interruption-before-terminal-result',
    provider.start(
      request(
        'Lis greeting.txt puis explique chaque caractère dans une réponse longue, sans modifier aucun fichier.',
      ),
    ),
    async (result) => {
      assert.equal(result.success, false);
      assert.notEqual(result.signal, null);
      assert.ok(result.native_session_id);
    },
    true,
  );
  report.status = 'passed';
} catch (failure) {
  report.status = 'failed';
  report.error = String(failure);
  process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  await mkdir(dirname(output), { recursive: true });
  const sanitized = JSON.stringify(report, null, 2).replaceAll(
    secret,
    '[REDACTED]',
  );
  await writeFile(output, sanitized + '\n');
  await rm(workspace, { recursive: true, force: true });
  console.log(JSON.stringify({ status: report.status, report: output }));
}
