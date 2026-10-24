#!/usr/bin/env node
// Offline protocol fixture: this executable never contacts a provider.
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('codex-cli 0.163.0');
} else if (args.includes('--help')) {
  console.log(
    'Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]\n--json --config',
  );
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
    emit({
      type: 'turn.completed',
      usage: { input_tokens: 11, cached_input_tokens: 3, output_tokens: 7 },
    });
    if (input.scenario === 'bad-exit') process.exitCode = 7;
  }
}
