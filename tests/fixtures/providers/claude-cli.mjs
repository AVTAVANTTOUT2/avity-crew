#!/usr/bin/env node
// Offline argv/permission fixture: this executable never contacts a provider.
const args = process.argv.slice(2);
let input = '';
for await (const chunk of process.stdin) input += chunk;
const denied = input === 'fixture-denied';
console.log(
  JSON.stringify({
    type: 'system',
    subtype: 'init',
    session_id: '11111111-1111-4111-8111-111111111111',
  }),
);
console.log(
  JSON.stringify({
    type: 'result',
    is_error: false,
    result: JSON.stringify({ args, input }),
    permission_denials: denied ? [{ tool_name: 'mcp__crew__create_task' }] : [],
  }),
);
