import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { CrewError, validate } from '../../contracts/src/index.ts';
import type { ToolCall } from '../../contracts/src/index.ts';
import { SupervisorClient } from './client.ts';
import { MAX_JSON_BYTES, object } from './protocol.ts';

// The installed provider integration uses the documented initialize lifecycle, not the newer stateless MCP revision.
export const MCP_PROTOCOL_VERSION = '2025-11-25';
export interface McpBridgeOptions {
  client: SupervisorClient;
  runId: string;
  input?: Readable;
  output?: Writable;
}

export async function runMcpBridge(options: McpBridgeOptions): Promise<void> {
  validate('Identifier', options.runId);
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  let initialized = false;
  let ready = false;
  const send = async (value: unknown): Promise<void> => {
    const line = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(line) > MAX_JSON_BYTES)
      throw new CrewError(
        'BODY_TOO_LARGE',
        'MCP response exceeds the line limit',
      );
    if (!output.write(line)) await once(output, 'drain');
  };
  const error = (id: unknown, code: number, message: string): Promise<void> =>
    send({ jsonrpc: '2.0', id, error: { code, message } });
  const dispatch = async (line: string): Promise<void> => {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      await error(null, -32700, 'Invalid JSON');
      return;
    }
    if (
      !object(request) ||
      request.jsonrpc !== '2.0' ||
      typeof request.method !== 'string' ||
      (request.id !== undefined &&
        typeof request.id !== 'string' &&
        (typeof request.id !== 'number' || !Number.isFinite(request.id)))
    ) {
      await error(null, -32600, 'Invalid JSON-RPC request');
      return;
    }
    if (request.id === undefined) {
      if (request.method === 'notifications/initialized' && initialized)
        ready = true;
      return;
    }
    const id = request.id;
    const params = object(request.params) ? request.params : {};
    if (request.method === 'initialize') {
      if (initialized || typeof params.protocolVersion !== 'string') {
        await error(id, -32602, 'Invalid initialization');
        return;
      }
      initialized = true;
      await send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'avity-crew', version: '1' },
        },
      });
      return;
    }
    if (!ready) {
      await error(id, -32000, 'Initialize the MCP connection first');
      return;
    }
    try {
      if (request.method === 'ping')
        await send({ jsonrpc: '2.0', id, result: {} });
      else if (request.method === 'tools/list')
        await send({
          jsonrpc: '2.0',
          id,
          result: { tools: await options.client.tools(options.runId) },
        });
      else if (request.method === 'tools/call') {
        if (
          typeof params.name !== 'string' ||
          !object(params.arguments) ||
          'method' in params.arguments
        ) {
          await error(
            id,
            -32602,
            'A full ToolCall envelope without method is required',
          );
          return;
        }
        const call: unknown = { ...params.arguments, method: params.name };
        validate('ToolCall', call);
        if ((call as ToolCall).run_id !== options.runId)
          throw new CrewError('WRONG_RUN', 'MCP call belongs to another run');
        try {
          const result = await options.client.execute(call as ToolCall);
          await send({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result ?? null) }],
            },
          });
        } catch (failure) {
          const code =
            failure instanceof CrewError &&
            /^[A-Z][A-Z0-9_]{0,63}$/.test(failure.code)
              ? failure.code
              : 'MCP_TOOL_ERROR';
          await send({
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [
                { type: 'text', text: JSON.stringify({ error: code }) },
              ],
            },
          });
        }
      } else await error(id, -32601, 'Unknown MCP method');
    } catch (failure) {
      const code =
        failure instanceof CrewError &&
        /^[A-Z][A-Z0-9_]{0,63}$/.test(failure.code)
          ? failure.code
          : 'INVALID_INPUT';
      await error(id, -32602, `Invalid MCP request (${code})`);
    }
  };
  const decoder = new StringDecoder('utf8');
  let pending = '';
  for await (const chunk of input) {
    pending +=
      typeof chunk === 'string' ? chunk : decoder.write(chunk as Buffer);
    let newline: number;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_JSON_BYTES) {
        await error(null, -32600, 'MCP line exceeds the limit');
        return;
      }
      if (line.trim()) await dispatch(line);
    }
    if (Buffer.byteLength(pending) > MAX_JSON_BYTES) {
      await error(null, -32600, 'MCP line exceeds the limit');
      return;
    }
  }
  pending += decoder.end();
  if (pending.trim())
    await error(null, -32700, 'MCP message must end with a newline');
}

export function runMcpFromEnv(): Promise<void> {
  const endpointFile = process.env.AVITY_CREW_ENDPOINT_FILE;
  const capability = process.env.AVITY_CREW_CAPABILITY;
  const runId = process.env.AVITY_CREW_RUN_ID;
  if (!endpointFile || !capability || !runId)
    throw new CrewError(
      'INVALID_INPUT',
      'MCP requires endpoint, capability and run ID environment variables',
    );
  return runMcpBridge({
    client: new SupervisorClient({ endpointFile, capability }),
    runId,
  });
}
