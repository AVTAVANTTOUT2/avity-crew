import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { CrewError, validate } from '../../contracts/src/index.ts';
import type { Actor } from '../../contracts/src/index.ts';
import type { Store } from '../../storage/src/index.ts';

export type Principal =
  { kind: 'user'; project_id: string } | { kind: 'agent'; actor: Actor };
const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

function privateRead(filename: string): string {
  const info = lstatSync(filename);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.size > 8192
  )
    throw new CrewError(
      'PRIVATE_FILE_INVALID',
      'Invalid private capability file',
    );
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

function writeNew(filename: string, content: string): void {
  const fd = openSync(filename, 'wx', 0o600);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export class CapabilityRegistry {
  readonly ownerKeyPath: string;
  private readonly directory: string;
  private readonly ownerHash: string;

  constructor(private readonly store: Store) {
    this.directory = join(store.project.data_dir, 'capabilities');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (lstatSync(this.directory).isSymbolicLink())
      throw new CrewError(
        'PRIVATE_FILE_INVALID',
        'Capabilities directory cannot be a symbolic link',
      );
    this.ownerKeyPath = join(store.project.data_dir, 'owner.key');
    try {
      writeNew(this.ownerKeyPath, randomBytes(32).toString('base64url'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const owner = privateRead(this.ownerKeyPath);
    if (!/^[A-Za-z0-9_-]{43}$/.test(owner))
      throw new CrewError('PRIVATE_FILE_INVALID', 'Invalid owner capability');
    this.ownerHash = digest(owner);
  }

  private assertCurrent(value: unknown): asserts value is Actor {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new CrewError('FORBIDDEN', 'Invalid capability actor');
    const actor = value as Actor;
    for (const value of [actor.id, actor.project_id, actor.run_id])
      validate('Identifier', value);
    if (actor.attempt_id !== null) validate('Identifier', actor.attempt_id);
    if (
      actor.project_id !== this.store.project.id ||
      !Number.isSafeInteger(actor.generation) ||
      actor.generation < 1
    )
      throw new CrewError(
        'FORBIDDEN',
        'Capability belongs to another project or generation',
      );
    const run = this.store.getRun(actor.run_id);
    if (['completed', 'failed', 'cancelled'].includes(run.status))
      throw new CrewError(
        'REVOKED_CAPABILITY',
        'Run no longer accepts agent actions',
      );
    if (actor.role === 'chief') {
      if (actor.task_id !== null || actor.generation !== run.generation)
        throw new CrewError(
          'REVOKED_CAPABILITY',
          'Chief authority has been replaced',
        );
      return;
    }
    if (!actor.task_id || !actor.attempt_id || actor.role === 'user')
      throw new CrewError(
        'FORBIDDEN',
        'Agent capability requires an assigned role and attempt',
      );
    const task = this.store.getTask(actor.task_id),
      attempt = this.store.getAttempt(actor.attempt_id);
    if (
      task.run_id !== run.id ||
      attempt.run_id !== run.id ||
      attempt.task_id !== task.id ||
      actor.role !== task.spec.role ||
      actor.id !== attempt.session_id ||
      task.active_attempt_id !== attempt.id ||
      task.generation !== actor.generation ||
      attempt.generation !== actor.generation ||
      ['accepted', 'cancelled'].includes(task.status)
    )
      throw new CrewError(
        'REVOKED_CAPABILITY',
        'Task authority has been replaced',
      );
  }

  issue(actor: Actor): string {
    this.assertCurrent(actor);
    const token = randomBytes(32).toString('base64url');
    const filename = join(this.directory, `${digest(token)}.json`);
    const temporary = `${filename}.tmp`;
    writeNew(temporary, JSON.stringify(actor));
    renameSync(temporary, filename);
    return token;
  }

  authenticate(token: string): Principal {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new CrewError('FORBIDDEN', 'Invalid capability');
    const hash = digest(token);
    if (
      timingSafeEqual(
        Buffer.from(hash, 'hex'),
        Buffer.from(this.ownerHash, 'hex'),
      )
    )
      return { kind: 'user', project_id: this.store.project.id };
    let actor: unknown;
    try {
      actor = JSON.parse(privateRead(join(this.directory, `${hash}.json`)));
    } catch {
      throw new CrewError('FORBIDDEN', 'Unknown capability');
    }
    this.assertCurrent(actor);
    return { kind: 'agent', actor };
  }
}
