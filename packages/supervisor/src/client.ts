import {
  constants,
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { CrewError, validate } from '../../contracts/src/index.ts';
import type { ToolCall } from '../../contracts/src/index.ts';
import {
  CONTROL_TIMEOUT_MS,
  LOCAL_PROTOCOL,
  MAX_JSON_BYTES,
  REQUEST_TIMEOUT_MS,
  object,
} from './protocol.ts';
import type {
  AdminRequest,
  ClientOptions,
  Endpoint,
  ToolDescriptor,
} from './protocol.ts';

function endpointFrom(path: string): Endpoint {
  let value: unknown;
  try {
    const info = lstatSync(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      info.size > 8192
    )
      throw new Error('private metadata required');
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      value = JSON.parse(readFileSync(fd, 'utf8'));
    } finally {
      closeSync(fd);
    }
    if (
      !object(value) ||
      value.protocol !== LOCAL_PROTOCOL ||
      typeof value.url !== 'string' ||
      !Number.isSafeInteger(value.pid) ||
      (value.pid as number) < 1 ||
      typeof value.nonce !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(value.nonce)
    )
      throw new Error('invalid metadata');
    validate('Identifier', value.project_id);
    const url = new URL(value.url);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== `/v1/${value.nonce}/`
    )
      throw new Error('non-loopback endpoint');
    return value as unknown as Endpoint;
  } catch {
    throw new CrewError(
      'SUPERVISOR_UNAVAILABLE',
      'Invalid or unavailable local endpoint metadata',
    );
  }
}

const CONTROLS = ['pause', 'stop', 'replace_chief', 'reassign'];

export class SupervisorClient {
  constructor(private readonly options: ClientOptions) {
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(options.capability) ||
      (options.timeout_ms !== undefined &&
        (!Number.isSafeInteger(options.timeout_ms) ||
          options.timeout_ms < 1 ||
          options.timeout_ms > 60_000))
    )
      throw new CrewError(
        'INVALID_INPUT',
        'Invalid local client configuration',
      );
  }
  private async invoke(
    route: string,
    body?: unknown,
    timeout_ms = this.options.timeout_ms ?? REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const endpoint = endpointFrom(this.options.endpointFile);
    const url = new URL(route, endpoint.url);
    let serialized: string | undefined;
    try {
      serialized = body === undefined ? undefined : JSON.stringify(body);
    } catch {
      throw new CrewError(
        'INVALID_INPUT',
        'Local requests must be JSON serializable',
      );
    }
    if (
      serialized !== undefined &&
      Buffer.byteLength(serialized) > MAX_JSON_BYTES
    )
      throw new CrewError('BODY_TOO_LARGE', 'Local request exceeds the limit');
    return new Promise((accept, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const fail = (): void => {
        clearTimeout(timer);
        reject(
          new CrewError(
            'SUPERVISOR_UNAVAILABLE',
            'Local connection failed; outcome may be unknown, reconnect and reuse the same ToolCall key',
          ),
        );
      };
      const request = httpRequest(
        url,
        {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            authorization: `Bearer ${this.options.capability}`,
            ...(serialized === undefined
              ? {}
              : {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(serialized),
                }),
          },
        },
        (response) => {
          let raw = '';
          let bytes = 0;
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes > MAX_JSON_BYTES) {
              clearTimeout(timer);
              reject(
                new CrewError(
                  'BODY_TOO_LARGE',
                  'Local response exceeds the limit',
                ),
              );
              response.destroy();
            } else raw += chunk;
          });
          response.on('error', fail);
          response.on('aborted', fail);
          response.on('end', () => {
            clearTimeout(timer);
            try {
              const value: unknown = JSON.parse(raw);
              if (!object(value) || typeof value.ok !== 'boolean')
                throw new Error('invalid envelope');
              if (!value.ok) {
                if (
                  !object(value.error) ||
                  typeof value.error.code !== 'string' ||
                  !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.error.code)
                )
                  throw new Error('invalid error');
                reject(
                  new CrewError(
                    value.error.code,
                    `Supervisor rejected the request (${value.error.code})`,
                  ),
                );
              } else if (response.statusCode === 200)
                accept(value.result ?? null);
              else throw new Error('unexpected status');
            } catch {
              reject(
                new CrewError(
                  'TRANSPORT_PROTOCOL_ERROR',
                  'Invalid local response',
                ),
              );
            }
          });
        },
      );
      timer = setTimeout(() => {
        fail();
        request.destroy();
      }, timeout_ms);
      request.on('error', fail);
      request.end(serialized);
    });
  }
  async tools(runId: string): Promise<ToolDescriptor[]> {
    validate('Identifier', runId);
    const result = await this.invoke(
      `tools?run_id=${encodeURIComponent(runId)}`,
    );
    if (
      !Array.isArray(result) ||
      result.some(
        (tool) =>
          !object(tool) ||
          typeof tool.name !== 'string' ||
          typeof tool.description !== 'string' ||
          !object(tool.inputSchema),
      )
    )
      throw new CrewError(
        'TRANSPORT_PROTOCOL_ERROR',
        'Invalid local tool list',
      );
    return result as ToolDescriptor[];
  }
  execute(call: ToolCall): Promise<unknown> {
    validate('ToolCall', call);
    return this.invoke('call', call);
  }
  admin(request: AdminRequest): Promise<unknown> {
    const timeout = this.options.timeout_ms ?? REQUEST_TIMEOUT_MS;
    return this.invoke(
      'admin',
      request,
      CONTROLS.includes(request.method)
        ? Math.max(timeout, CONTROL_TIMEOUT_MS)
        : timeout,
    );
  }
}
