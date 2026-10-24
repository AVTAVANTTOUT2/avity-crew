import { randomUUID } from 'node:crypto';
import {
  constants,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { CrewError, validate } from '../../contracts/src/index.ts';
import type { ToolCall } from '../../contracts/src/index.ts';
import type { Principal } from './capabilities.ts';
import {
  LOCAL_PROTOCOL,
  MAX_JSON_BYTES,
  REQUEST_TIMEOUT_MS,
  object,
} from './protocol.ts';
import type {
  AdminRequest,
  Endpoint,
  LocalResponse,
  TransportHandle,
  TransportOptions,
} from './protocol.ts';

function privateJson(path: string): Record<string, unknown> {
  const info = lstatSync(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.size > 8192
  )
    throw new CrewError(
      'PRIVATE_FILE_INVALID',
      'Invalid supervisor metadata file',
    );
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const value: unknown = JSON.parse(readFileSync(fd, 'utf8'));
    if (!object(value)) throw new Error('object required');
    return value;
  } catch {
    throw new CrewError('PRIVATE_FILE_INVALID', 'Invalid supervisor metadata');
  } finally {
    closeSync(fd);
  }
}

function metadata(value: Record<string, unknown>, project: string): void {
  if (
    value.protocol !== LOCAL_PROTOCOL ||
    value.project_id !== project ||
    !Number.isSafeInteger(value.pid) ||
    (value.pid as number) < 1 ||
    typeof value.nonce !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(value.nonce)
  )
    throw new CrewError(
      'SUPERVISOR_LOCKED',
      'Supervisor ownership is ambiguous; inspect local metadata',
    );
}
function dead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (failure) {
    return (failure as NodeJS.ErrnoException).code === 'ESRCH';
  }
}
function removeOwned(path: string, nonce: string): void {
  try {
    if (privateJson(path).nonce === nonce) unlinkSync(path);
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure;
  }
}
function writeNew(path: string, value: unknown): void {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function reclaim(path: string, project: string): void {
  const previous = privateJson(path);
  metadata(previous, project);
  if (!dead(previous.pid as number))
    throw new CrewError(
      'SUPERVISOR_LOCKED',
      'A live or inaccessible supervisor owns this project',
    );
  removeOwned(path, previous.nonce as string);
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((accept, reject) => {
    let body = '';
    let bytes = 0;
    let done = false;
    const finish = (failure?: CrewError): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (failure) reject(failure);
      else {
        try {
          accept(JSON.parse(body));
        } catch {
          reject(new CrewError('INVALID_JSON', 'Invalid JSON request'));
        }
      }
    };
    const timer = setTimeout(() => {
      request.pause();
      finish(new CrewError('REQUEST_TIMEOUT', 'Request body timed out'));
    }, REQUEST_TIMEOUT_MS);
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      if (done) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_JSON_BYTES) {
        request.pause();
        finish(
          new CrewError('BODY_TOO_LARGE', 'Request body exceeds the limit'),
        );
      } else body += chunk;
    });
    request.on('end', () => finish());
    request.on('aborted', () =>
      finish(new CrewError('REQUEST_ABORTED', 'Client disconnected')),
    );
    request.on('error', () =>
      finish(new CrewError('REQUEST_ABORTED', 'Client disconnected')),
    );
  });
}

function publicError(failure: unknown): LocalResponse & { ok: false } {
  const code =
    failure instanceof CrewError && /^[A-Z][A-Z0-9_]{0,63}$/.test(failure.code)
      ? failure.code
      : 'INTERNAL_ERROR';
  return {
    ok: false,
    error: { code, message: `Supervisor rejected the request (${code})` },
  };
}

export async function startTransport(
  options: TransportOptions,
): Promise<TransportHandle> {
  validate('Identifier', options.project_id);
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(options.directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new CrewError(
      'PRIVATE_FILE_INVALID',
      'Supervisor directory must be private',
    );
  const directory = realpathSync(options.directory);
  const lock = join(directory, 'supervisor.lock');
  const endpointFile = join(directory, 'endpoint.json');
  const nonce = randomUUID();
  const ownership: Omit<Endpoint, 'url'> = {
    protocol: LOCAL_PROTOCOL,
    project_id: options.project_id,
    pid: process.pid,
    nonce,
  };
  const starting = join(directory, 'supervisor.starting');
  try {
    writeNew(starting, ownership);
  } catch {
    throw new CrewError(
      'SUPERVISOR_LOCKED',
      'Startup is in progress or its ownership needs inspection',
    );
  }
  try {
    try {
      writeNew(lock, ownership);
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code !== 'EEXIST') throw failure;
      reclaim(lock, options.project_id);
      try {
        writeNew(lock, ownership);
      } catch {
        throw new CrewError(
          'SUPERVISOR_LOCKED',
          'Another supervisor acquired the project',
        );
      }
    }
  } catch (failure) {
    removeOwned(starting, nonce);
    throw failure;
  }
  let endpoint: Endpoint | undefined;
  const authenticate = (token: string): Principal => {
    const principal = options.registry.authenticate(token);
    if (
      (principal.kind === 'user'
        ? principal.project_id
        : principal.actor.project_id) !== options.project_id
    )
      throw new CrewError('FORBIDDEN', 'Capability belongs to another project');
    return principal;
  };
  const authorizeRun = (principal: Principal, runId: string): void => {
    validate('Identifier', runId);
    if (principal.kind === 'agent' && principal.actor.run_id !== runId)
      throw new CrewError('WRONG_RUN', 'Agent cannot access another run');
  };
  const server = createServer((request, response) => {
    const send = (status: number, value: LocalResponse): void => {
      if (response.destroyed) return;
      let body = JSON.stringify(value);
      if (Buffer.byteLength(body) > MAX_JSON_BYTES) {
        status = 413;
        body = JSON.stringify(
          publicError(
            new CrewError('BODY_TOO_LARGE', 'Response exceeds the limit'),
          ),
        );
      }
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        connection: 'close',
      });
      response.end(body);
    };
    void (async () => {
      try {
        if (
          !endpoint ||
          request.headers.host !== new URL(endpoint.url).host ||
          request.headers.origin
        )
          throw new CrewError('FORBIDDEN', 'Invalid local request origin');
        const authorization = request.headers.authorization;
        if (!authorization?.startsWith('Bearer '))
          throw new CrewError('FORBIDDEN', 'Capability required');
        let principal = authenticate(authorization.slice(7));
        const url = new URL(request.url ?? '', endpoint.url);
        if (!url.pathname.startsWith(`/v1/${nonce}/`))
          throw new CrewError('NOT_FOUND', 'Unknown endpoint');
        const route = url.pathname.slice(`/v1/${nonce}/`.length);
        if (request.method === 'GET' && route === 'health') {
          send(200, { ok: true, result: ownership });
          return;
        }
        if (request.method === 'GET' && route === 'tools') {
          const runId = url.searchParams.get('run_id') ?? '';
          authorizeRun(principal, runId);
          send(200, { ok: true, result: options.api.tools(principal, runId) });
          return;
        }
        if (request.method !== 'POST' || !['call', 'admin'].includes(route))
          throw new CrewError('NOT_FOUND', 'Unknown route or method');
        if (
          request.headers['content-type']?.split(';')[0]?.trim() !==
          'application/json'
        )
          throw new CrewError('INVALID_JSON', 'JSON content type required');
        if (Number(request.headers['content-length'] ?? 0) > MAX_JSON_BYTES)
          throw new CrewError('BODY_TOO_LARGE', 'Request exceeds the limit');
        const body = await readBody(request);
        principal = authenticate(authorization.slice(7));
        if (route === 'call') {
          validate('ToolCall', body);
          const call = body as ToolCall;
          authorizeRun(principal, call.run_id);
          if (
            !options.api
              .tools(principal, call.run_id)
              .some((tool) => tool.name === call.method)
          )
            throw new CrewError(
              'FORBIDDEN',
              'Tool is not available to this capability',
            );
          send(200, {
            ok: true,
            result: await options.api.execute(principal, call),
          });
        } else {
          if (principal.kind !== 'user')
            throw new CrewError('FORBIDDEN', 'Owner capability required');
          if (
            !object(body) ||
            Object.keys(body).some(
              (key) => !['method', 'arguments'].includes(key),
            ) ||
            typeof body.method !== 'string' ||
            !/^[a-z][a-z0-9_]{0,63}$/.test(body.method) ||
            !object(body.arguments)
          )
            throw new CrewError('INVALID_INPUT', 'Invalid admin request');
          send(200, {
            ok: true,
            result: await options.api.admin(
              principal,
              body as unknown as AdminRequest,
            ),
          });
        }
      } catch (failure) {
        const value = publicError(failure);
        const status = [
          'FORBIDDEN',
          'REVOKED_CAPABILITY',
          'WRONG_RUN',
        ].includes(value.error.code)
          ? 403
          : value.error.code === 'BODY_TOO_LARGE'
            ? 413
            : value.error.code === 'NOT_FOUND'
              ? 404
              : value.error.code === 'INTERNAL_ERROR'
                ? 500
                : 400;
        response.once('finish', () => {
          if (!request.complete) request.destroy();
        });
        send(status, value);
      }
    })();
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = REQUEST_TIMEOUT_MS;
  server.maxHeadersCount = 32;
  try {
    try {
      reclaim(endpointFile, options.project_id);
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure;
    }
    await new Promise<void>((accept, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', accept);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new CrewError('TRANSPORT_ERROR', 'Local TCP address unavailable');
    endpoint = {
      ...ownership,
      url: `http://127.0.0.1:${address.port}/v1/${nonce}/`,
    };
    const temporary = `${endpointFile}.${nonce}.tmp`;
    writeNew(temporary, endpoint);
    renameSync(temporary, endpointFile);
  } catch (failure) {
    server.closeAllConnections();
    server.close();
    removeOwned(lock, nonce);
    throw failure;
  } finally {
    removeOwned(starting, nonce);
  }
  let closing: Promise<void> | undefined;
  return {
    endpointFile,
    endpoint,
    close: () =>
      (closing ??= (async () => {
        server.closeAllConnections();
        await new Promise<void>((accept, reject) =>
          server.close((failure) => (failure ? reject(failure) : accept())),
        );
        removeOwned(endpointFile, nonce);
        removeOwned(lock, nonce);
      })()),
  };
}
