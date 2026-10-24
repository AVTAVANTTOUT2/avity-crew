#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Offline protocol fixture: this executable never contacts a provider.
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('codex-cli 0.163.0');
} else if (args.includes('--help')) {
  console.log(
    'Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]\n--json --config',
  );
} else if (args.includes('mcp') && args.includes('list')) {
  const path = resolve(process.cwd(), '.codex-fixture-inventory.json');
  const inventory = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : [{ name: 'ambientFixture', enabled: true }];
  if (inventory?.diagnostic_error) {
    console.error('sensitive-inventory-diagnostic');
    process.exitCode = 1;
  } else if (inventory?.malformed_output) {
    console.log('sensitive-inventory-diagnostic {');
  } else console.log(JSON.stringify(inventory));
} else {
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  const input = JSON.parse(prompt);
  const id = args.includes('resume') ? args.at(-2) : input.id;
  const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  emit({ type: 'thread.started', thread_id: id });
  if (input.scenario === 'wait') {
    process.on('SIGINT', () => {
      emit({ type: 'turn.completed' });
      process.exit(0);
    });
    setInterval(() => {}, 1000);
  } else if (input.scenario === 'failure') {
    emit({ type: 'turn.failed', error: { message: input.message } });
  } else if (input.scenario === 'truncated') {
    process.stdout.write('{"type":"turn.completed"');
  } else {
    if (
      ['warnings', 'warnings-bad-exit', 'warnings-no-result'].includes(
        input.scenario,
      )
    ) {
      for (const [id, message] of [
        [
          'warning_0',
          'Codex is ignoring 3 unrecognized configuration settings. Diagnostic details remain visible.',
        ],
        [
          'warning_1',
          'Under-development features enabled: fixture. Under-development features are incomplete and may behave unpredictably.',
        ],
      ])
        emit({ type: 'item.completed', item: { id, type: 'error', message } });
    }
    if (input.scenario === 'mcp-denied')
      emit({
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
          server: 'crew',
          tool: 'ping',
          status: 'failed',
          error: {
            message:
              'MCP tool call requires approval, but approval policy is never',
          },
        },
      });
    if (input.scenario === 'unknown')
      emit({ type: 'future.notification', data: 42 });
    const response =
      input.scenario === 'capture'
        ? JSON.stringify({
            args,
            prompt,
            cwd: process.cwd(),
            token_present: Boolean(process.env.AVITY_CREW_BRIDGE_TOKEN),
          })
        : input.scenario === 'leak'
          ? process.env.AVITY_CREW_BRIDGE_TOKEN
          : input.message;
    const line = `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', id: 'message_1', text: response } })}\n`;
    if (input.scenario === 'fragmented') {
      const bytes = Buffer.from(line);
      for (let i = 0; i < bytes.length; i += 3) {
        process.stdout.write(bytes.subarray(i, i + 3));
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    } else process.stdout.write(line);
    if (input.scenario !== 'warnings-no-result')
      emit({
        type: 'turn.completed',
        usage: { input_tokens: 11, cached_input_tokens: 3, output_tokens: 7 },
      });
    if (['bad-exit', 'warnings-bad-exit'].includes(input.scenario))
      process.exitCode = 7;
  }
}
