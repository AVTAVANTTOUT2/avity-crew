import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  writeFileSync,
  readFileSync,
  existsSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:net';
import { CrewError } from '../../contracts/src/index.ts';

export interface ResourceLease {
  ports: number[];
  temporaryDirectory: string;
  databasePath: string;
  exclusiveResources: string[];
  release(): Promise<void>;
}

export async function reserveResources(
  root: string,
  count = 1,
  exclusiveResources: readonly string[] = [],
): Promise<ResourceLease> {
  if (!Number.isSafeInteger(count) || count < 0 || count > 16)
    throw new CrewError(
      'INVALID_RESOURCE_COUNT',
      'Reserve between zero and sixteen ports',
    );
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const temporaryDirectory = mkdtempSync(join(root, 'resources-'));
  chmodSync(temporaryDirectory, 0o700);
  const servers: Server[] = [];
  const ports: number[] = [];
  const locks: { path: string; nonce: string; fd: number }[] = [];
  let released: Promise<void> | undefined;
  const release = (): Promise<void> =>
    (released ??= (async () => {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve, reject) => {
              if (!server.listening) {
                resolve();
                return;
              }
              server.close((error) => (error ? reject(error) : resolve()));
            }),
        ),
      );
      for (const lock of locks) {
        closeSync(lock.fd);
        if (
          existsSync(lock.path) &&
          JSON.parse(readFileSync(lock.path, 'utf8')).nonce === lock.nonce
        )
          unlinkSync(lock.path);
      }
    })());
  try {
    for (const name of new Set(exclusiveResources)) {
      if (typeof name !== 'string' || !name.trim())
        throw new CrewError(
          'INVALID_RESOURCE',
          'Exclusive resource names must be non-empty',
        );
      const path = join(
          root,
          `exclusive-${createHash('sha256').update(name).digest('hex')}.lock`,
        ),
        nonce = randomUUID();
      let fd: number;
      try {
        fd = openSync(path, 'wx', 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new CrewError(
            'RESOURCE_BUSY',
            'Exclusive resource already has an owner',
            { name, path },
          );
        throw error;
      }
      locks.push({ path, fd, nonce });
      writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce, name }));
    }
    for (let index = 0; index < count; index++) {
      const server = createServer((socket) => socket.destroy());
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      ports.push((server.address() as { port: number }).port);
    }
  } catch (error) {
    await release();
    throw error;
  }
  return {
    ports,
    temporaryDirectory,
    databasePath: join(temporaryDirectory, 'test.sqlite'),
    exclusiveResources: [...new Set(exclusiveResources)],
    release,
  };
}
