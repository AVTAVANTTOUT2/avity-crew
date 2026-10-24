// Minimal real MCP server used only by explicitly invoked live verification.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

const send = (id, result) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
for await (const line of createInterface({ input: process.stdin })) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    continue;
  }
  if (request.id === undefined) continue;
  if (process.env.AVITY_CREW_MCP_AUDIT)
    appendFileSync(
      process.env.AVITY_CREW_MCP_AUDIT,
      JSON.stringify({
        method: request.method,
        tool: request.params?.name ?? null,
      }) + '\n',
    );
  if (request.method === 'initialize')
    send(request.id, {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'avity-crew-live-ping', version: '1.0.0' },
    });
  else if (request.method === 'tools/list')
    send(request.id, {
      tools: [
        {
          name: 'ping',
          description:
            'Return a harmless pong to prove the real MCP bridge was called',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          },
        },
      ],
    });
  else if (request.method === 'tools/call' && request.params?.name === 'ping')
    send(request.id, {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            pong: request.params.arguments.message,
            token_present: Boolean(process.env.AVITY_CREW_BRIDGE_TOKEN),
          }),
        },
      ],
    });
  else if (request.method === 'ping') send(request.id, {});
  else
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: 'Method not found' },
      }) + '\n',
    );
}
