import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const [prefix,provider]=process.argv.slice(2);
assert.ok(['claude','codex'].includes(provider));
const {ClaudeProvider,CodexProvider}=await import(pathToFileURL(join(prefix,'lib/node_modules/avity-crew/dist/packages/providers/src/index.js')));
const adapter=provider==='claude'?new ClaudeProvider():new CodexProvider();
const capabilities=await adapter.probe();
assert.equal(capabilities.structured_events.status,'supported');
const cwd=await mkdtemp(join(tmpdir(),'crew permission probe '));
const audit=join(cwd,'audit.jsonl');
let timer;
try {
  const run=adapter.start({cwd,prompt:'Call the crew MCP tool ping exactly once, with message PERMISSION_PROBE. It is the only requested action. If native permissions deny it, report that denial and stop. Do not run shell commands, use other tools, create files, or simulate a response.',model:null,role:'developer',permissions:{sandbox:'read-only',approval:'never'},bridge:{command:process.execPath,args:[fileURLToPath(new URL('./permission-server.mjs',import.meta.url))],env:{PROBE_AUDIT:audit},approved_tools:[]}});
  timer=setTimeout(()=>{void run.interrupt()},45000);
  const counts={};
  const consume=(async()=>{for await(const event of run.events) counts[event.type]=(counts[event.type]??0)+1})();
  const result=await run.result;await consume;
  const methods=(await readFile(audit,'utf8')).trim().split('\n').map(l=>JSON.parse(l).method);
  const calls=methods.filter(m=>m==='tools/call').length;
  const summary={provider,version:capabilities.version,success:result.success,error_kind:result.error?.kind??null,exit_code:result.exit_code,native_session_id:result.native_session_id,events:counts,mcp_initialized:methods.includes('initialize'),mcp_listed:methods.includes('tools/list'),mcp_tool_calls:calls,requested_model:null};
  console.log(JSON.stringify(summary));
  assert.equal(result.success,false,'A denied tool must not become success');
  assert.equal(result.error?.kind,'permission','A native denial event, not a verbal report, is required');
  assert.ok(counts.permission>0);assert.equal(calls,0);
  console.log('NATIVE_PERMISSION_OK');
} finally {clearTimeout(timer);await rm(cwd,{recursive:true,force:true})}
