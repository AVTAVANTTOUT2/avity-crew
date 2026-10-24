import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, matchesGlob, relative } from 'node:path';
import { CrewError, now, validate } from '../../contracts/src/index.ts';
import type { Actor, Operation, Workspace } from '../../contracts/src/index.ts';
import { Store, redactSecrets } from '../../storage/src/index.ts';
import { git, inspectRepository, line, runCommand } from './git.ts';
import { reserveResources as reserveLocalResources } from './resources.ts';
import type { ResourceLease } from './resources.ts';
export { inspectRepository } from './git.ts';
export type { RepositoryState } from './git.ts';
export { reserveResources } from './resources.ts';
export type { ResourceLease } from './resources.ts';

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);
const stepKey = (key: string, step: string): string =>
  `workspace:${digest(key + ':' + step)}`;
const sha = (revision: string): string => {
  if (!/^git:(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision))
    throw new CrewError(
      'INVALID_REVISION',
      'An exact Git commit revision is required',
    );
  return revision.slice(4);
};

export interface WorkspaceHandle {
  type: 'workspace';
  id: string;
  operationId: string;
  taskId: string;
  attemptId: string;
  mode: 'code' | 'documentation' | 'read-only';
  path: string;
  branch: string | null;
  baseRevision: string | null;
  temporaryDirectory: string;
  databasePath: string;
  ports: number[];
  exclusiveResources: string[];
}

export interface Delivery {
  type: 'delivery';
  id: string;
  operationId: string;
  workspaceOperationId: string;
  mode: 'code' | 'documentation';
  baseRevision: string | null;
  sourceRevision: string;
  changedPaths: string[];
  preservationRef: string | null;
  documents: { path: string; reference: string; revision: string }[];
}

export interface Scope {
  writePaths: readonly string[];
  excludedPaths?: readonly string[];
  documentPaths?: readonly string[];
}

export interface Check {
  id: string;
  command: readonly string[];
  timeoutMs?: number;
}

export interface CheckProof {
  id: string;
  command: readonly string[];
  candidateRevision: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  output: string;
  truncated: boolean;
  startedAt: string;
  endedAt: string;
}

export interface IntegrationCandidate {
  type: 'integration';
  operationId: string;
  status: 'validated' | 'conflict' | 'validation_failed';
  targetRef: string;
  expectedBase: string;
  candidateRevision: string;
  candidateRef: string;
  path: string;
  deliveryOperationIds: readonly string[];
  proofs: CheckProof[];
  conflicts: string[];
}

export interface Promotion {
  type: 'promotion';
  operationId: string;
  preparationOperationId: string;
  targetRef: string;
  previousRevision: string;
  revision: string;
}

type WorkspaceStore = Pick<
  Store,
  | 'project'
  | 'getRun'
  | 'getTask'
  | 'getAttempt'
  | 'getRecord'
  | 'beginOperation'
  | 'observeOperation'
  | 'saveWorkspace'
  | 'writeArtifact'
>;

function assertScope(paths: readonly string[], scope: Scope): void {
  const matches = (path: string, pattern: string) =>
    path === pattern ||
    path.startsWith(pattern.replace(/\/$/, '') + '/') ||
    matchesGlob(path, pattern);
  const outside = paths.filter(
    (path) =>
      !scope.writePaths.some((pattern) => matches(path, pattern)) ||
      scope.excludedPaths?.some((pattern) => matches(path, pattern)),
  );
  if (outside.length)
    throw new CrewError(
      'OUTSIDE_SCOPE',
      'Delivery changes files outside its declared scope',
      outside,
    );
}

export class WorkspaceManager {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly root: string;

  constructor(
    private readonly store: WorkspaceStore,
    private readonly actor: Actor,
  ) {
    if (
      actor.role !== 'user' ||
      actor.project_id !== store.project.id ||
      store.getRun(actor.run_id).project_id !== actor.project_id
    )
      throw new CrewError(
        'FORBIDDEN',
        'Workspace administration requires the authenticated service actor',
      );
    this.root = store.project.root;
  }

  private version(): number {
    return this.store.getRun(this.actor.run_id).version;
  }
  reserveResources(
    count = 1,
    exclusiveResources: readonly string[] = [],
  ): Promise<ResourceLease> {
    return reserveLocalResources(
      join(this.store.project.data_dir, 'resources'),
      count,
      exclusiveResources,
    );
  }
  private open(key: string, kind: string, input: unknown): Operation {
    const created = this.store.beginOperation(
      this.actor,
      kind,
      JSON.stringify(input),
      key,
      this.version(),
    );
    return this.store.getRecord<Operation>(
      this.actor.run_id,
      'operation',
      created.id,
    );
  }
  private finish<T>(operation: Operation, key: string, result: T): T {
    if (operation.status !== 'completed')
      this.store.observeOperation(
        this.actor,
        operation.id,
        'completed',
        result,
        stepKey(key, 'completed'),
        this.version(),
      );
    return result;
  }
  private uncertain(operation: Operation, key: string, error: unknown): never {
    this.store.observeOperation(
      this.actor,
      operation.id,
      'unknown',
      {
        error: redactSecrets((error as Error).message),
        code: error instanceof CrewError ? error.code : 'EXTERNAL_FAILURE',
        details:
          error instanceof CrewError
            ? JSON.parse(redactSecrets(JSON.stringify(error.details) ?? 'null'))
            : null,
      },
      stepKey(key, 'unknown'),
      this.version(),
    );
    throw error;
  }
  private result<T extends { type: string }>(
    id: string,
    kind: string,
    type: T['type'],
  ): T {
    const operation = this.store.getRecord<Operation>(
      this.actor.run_id,
      'operation',
      id,
    );
    const result = operation.result as T | null;
    if (
      operation.kind !== kind ||
      operation.status !== 'completed' ||
      result?.type !== type
    )
      throw new CrewError(
        'INVALID_OPERATION',
        `A completed ${kind} operation is required`,
      );
    return result;
  }

  async initializeRepository(
    options: { authorized: true; createEmptyBaseline?: boolean },
    key: string,
  ): Promise<Awaited<ReturnType<typeof inspectRepository>>> {
    if (options.authorized !== true)
      throw new CrewError(
        'INITIALIZATION_NOT_AUTHORIZED',
        'Git initialization must be explicitly authorized',
      );
    const operation = this.open(key, 'git.initialize', options);
    if (operation.status === 'completed')
      return operation.result as Awaited<ReturnType<typeof inspectRepository>>;
    try {
      let state = await inspectRepository(this.root);
      if (!state.commonDir)
        await git(this.root, ['init', '--initial-branch=main']);
      state = await inspectRepository(this.root);
      if (!state.head && options.createEmptyBaseline) {
        const staged = await git(this.root, ['ls-files', '-z']);
        if (staged.stdout)
          throw new CrewError(
            'DIRTY_INDEX',
            'An empty baseline cannot include staged user files',
          );
        const tree = line((await git(this.root, ['mktree'])).stdout);
        const commit = line(
          (
            await git(this.root, [
              '-c',
              'user.name=Avity Crew',
              '-c',
              'user.email=avity-crew@localhost',
              'commit-tree',
              tree,
              '-m',
              'Initialize Avity Crew baseline',
            ])
          ).stdout,
        );
        await git(this.root, [
          'update-ref',
          'HEAD',
          commit,
          '0'.repeat(commit.length),
        ]);
      }
      return this.finish(operation, key, await inspectRepository(this.root));
    } catch (error) {
      return this.uncertain(operation, key, error);
    }
  }

  async createWorkspace(
    request: {
      taskId: string;
      attemptId: string;
      mode: WorkspaceHandle['mode'];
      baseRevision: string | null;
      resources?: ResourceLease;
    },
    key: string,
  ): Promise<WorkspaceHandle> {
    const task = this.store.getTask(request.taskId),
      attempt = this.store.getAttempt(request.attemptId);
    if (
      task.run_id !== this.actor.run_id ||
      task.active_attempt_id !== attempt.id ||
      attempt.task_id !== task.id ||
      task.generation !== attempt.generation
    )
      throw new CrewError(
        'STALE_ATTEMPT',
        'Workspace must belong to the current task attempt',
      );
    if (!['code', 'documentation', 'read-only'].includes(request.mode))
      throw new CrewError('INVALID_WORKSPACE_MODE', 'Unknown workspace mode');
    const operation = this.open(key, 'workspace.create', request);
    if (operation.status === 'completed')
      return operation.result as WorkspaceHandle;
    const id = `workspace:${digest(operation.id)}`;
    let path =
      request.mode === 'code'
        ? join(this.store.project.data_dir, 'workspaces', digest(operation.id))
        : this.root;
    const branch =
      request.mode === 'code'
        ? `avity-crew/task-${digest(operation.id)}`
        : null;
    const temporaryDirectory =
      request.resources?.temporaryDirectory ??
      join(this.store.project.data_dir, 'resources', digest(operation.id));
    const ports = [...(request.resources?.ports ?? [])];
    if (
      ports.some(
        (port) => !Number.isSafeInteger(port) || port < 1 || port > 65535,
      ) ||
      new Set(ports).size !== ports.length
    )
      throw new CrewError(
        'INVALID_PORTS',
        'Assigned ports must be distinct valid port numbers',
      );
    if (request.resources) {
      const location = relative(
        realpathSync(this.store.project.data_dir),
        realpathSync(temporaryDirectory),
      );
      const database = relative(
        temporaryDirectory,
        request.resources.databasePath,
      );
      if (
        isAbsolute(location) ||
        location.startsWith('..') ||
        isAbsolute(database) ||
        database.startsWith('..')
      )
        throw new CrewError(
          'INVALID_RESOURCE_SCOPE',
          'Workspace resources must belong to this project namespace',
        );
    }
    try {
      mkdirSync(temporaryDirectory, { recursive: true, mode: 0o700 });
      if (request.mode === 'code') {
        if (!request.baseRevision)
          throw new CrewError(
            'BASE_REQUIRED',
            'Code workspaces require an exact base commit',
          );
        const base = sha(request.baseRevision);
        await git(this.root, ['cat-file', '-e', `${base}^{commit}`]);
        if (!existsSync(path)) {
          mkdirSync(join(this.store.project.data_dir, 'workspaces'), {
            recursive: true,
            mode: 0o700,
          });
          await git(this.root, [
            'worktree',
            'add',
            '--no-track',
            '-b',
            branch!,
            path,
            base,
          ]);
        } else {
          const state = await inspectRepository(path);
          if (
            state.branch !== `refs/heads/${branch}` ||
            state.commonDir !== (await inspectRepository(this.root)).commonDir
          )
            throw new CrewError(
              'RECONCILIATION_REQUIRED',
              'Existing workspace identity does not match its operation',
            );
        }
        path = realpathSync(path);
        const record: Workspace = {
          id,
          run_id: this.actor.run_id,
          task_id: task.id,
          path,
          branch: branch!,
          base_revision: request.baseRevision,
          ports,
          temporary_dir: temporaryDirectory,
        };
        this.store.saveWorkspace(
          this.actor,
          record,
          stepKey(key, 'workspace-record'),
          this.version(),
        );
      }
      return this.finish(operation, key, {
        type: 'workspace',
        id,
        operationId: operation.id,
        taskId: task.id,
        attemptId: attempt.id,
        mode: request.mode,
        path,
        branch,
        baseRevision: request.baseRevision,
        temporaryDirectory,
        databasePath:
          request.resources?.databasePath ??
          join(temporaryDirectory, 'test.sqlite'),
        ports,
        exclusiveResources: [...(request.resources?.exclusiveResources ?? [])],
      } satisfies WorkspaceHandle);
    } catch (error) {
      return this.uncertain(operation, key, error);
    }
  }

  async collectDelivery(
    workspaceOperationId: string,
    scope: Scope,
    key: string,
  ): Promise<Delivery> {
    const workspace = this.result<WorkspaceHandle>(
      workspaceOperationId,
      'workspace.create',
      'workspace',
    );
    if (workspace.mode === 'read-only')
      throw new CrewError(
        'READ_ONLY_WORKSPACE',
        'Read-only tasks do not create a delivery',
      );
    const assigned = this.store.getTask(workspace.taskId).spec.scope;
    const verifyScope = (paths: readonly string[]) => {
      assertScope(paths, scope);
      assertScope(paths, {
        writePaths: assigned.write_paths,
        excludedPaths: assigned.excluded_paths,
      });
    };
    const operation = this.open(key, 'workspace.collect', {
      workspaceOperationId,
      scope,
    });
    if (operation.status === 'completed') return operation.result as Delivery;
    try {
      const delivery: Delivery = {
        type: 'delivery',
        id: `delivery:${digest(operation.id)}`,
        operationId: operation.id,
        workspaceOperationId,
        mode: workspace.mode,
        baseRevision: workspace.baseRevision,
        sourceRevision: '',
        changedPaths: [],
        preservationRef: null,
        documents: [],
      };
      if (workspace.mode === 'documentation') {
        const paths = [...(scope.documentPaths ?? [])];
        if (!paths.length)
          throw new CrewError(
            'DOCUMENTS_REQUIRED',
            'Document snapshots require explicit file paths',
          );
        verifyScope(paths);
        for (const path of paths) {
          if (
            isAbsolute(path) ||
            /^[A-Za-z]:/.test(path) ||
            path.includes('\\') ||
            path.includes('\0') ||
            path
              .split('/')
              .some((part) => !part || part === '.' || part === '..')
          )
            throw new CrewError(
              'INVALID_DOCUMENT',
              'Document paths must be canonical relative paths',
            );
          const absolute = join(workspace.path, path),
            rel = relative(
              realpathSync(workspace.path),
              realpathSync(absolute),
            );
          if (
            isAbsolute(path) ||
            isAbsolute(rel) ||
            rel.startsWith('..') ||
            lstatSync(absolute).isSymbolicLink() ||
            !lstatSync(absolute).isFile()
          )
            throw new CrewError(
              'INVALID_DOCUMENT',
              'Document must be a regular file inside its workspace',
            );
          // An in-project directory alias must not bypass the assigned file scope.
          verifyScope([rel.replaceAll('\\', '/')]);
          delivery.documents.push({
            path,
            ...this.store.writeArtifact(readFileSync(absolute)),
          });
        }
        delivery.changedPaths = paths;
        delivery.baseRevision = null;
        delivery.sourceRevision = this.store.writeArtifact(
          JSON.stringify(delivery.documents),
        ).revision;
      } else {
        const identity = await inspectRepository(workspace.path);
        if (
          identity.branch !== `refs/heads/${workspace.branch}` ||
          identity.commonDir !== (await inspectRepository(this.root)).commonDir
        )
          throw new CrewError(
            'WORKSPACE_CHANGED',
            'Workspace Git identity changed after assignment',
          );
        const base = sha(workspace.baseRevision!);
        const ref = `refs/avity-crew/deliveries/${digest(operation.id)}`;
        let commit = await git(this.root, ['rev-parse', '--verify', ref], true);
        if (commit.exitCode !== 0) {
          const changed = await git(workspace.path, [
            'diff',
            '--name-only',
            '--no-renames',
            '-z',
            base,
            '--',
          ]);
          const untracked = await git(workspace.path, [
            'ls-files',
            '--others',
            '--exclude-standard',
            '-z',
          ]);
          verifyScope(
            [
              ...changed.stdout.split('\0'),
              ...untracked.stdout.split('\0'),
            ].filter(Boolean),
          );
          await git(workspace.path, ['add', '--all', '--']);
          const tree = line((await git(workspace.path, ['write-tree'])).stdout);
          const paths = (
            await git(workspace.path, [
              'diff',
              '--name-only',
              '--no-renames',
              '-z',
              base,
              tree,
              '--',
            ])
          ).stdout
            .split('\0')
            .filter(Boolean);
          verifyScope(paths);
          const snapshot = line(
            (
              await git(workspace.path, [
                '-c',
                'user.name=Avity Crew',
                '-c',
                'user.email=avity-crew@localhost',
                'commit-tree',
                tree,
                '-p',
                base,
                '-m',
                `Avity Crew delivery ${workspace.taskId} / ${workspace.attemptId}`,
              ])
            ).stdout,
          );
          await git(this.root, [
            'update-ref',
            ref,
            snapshot,
            '0'.repeat(snapshot.length),
          ]);
          commit = await git(this.root, ['rev-parse', '--verify', ref]);
        }
        delivery.sourceRevision = `git:${line(commit.stdout)}`;
        delivery.changedPaths = (
          await git(this.root, [
            'diff',
            '--name-only',
            '--no-renames',
            '-z',
            base,
            sha(delivery.sourceRevision),
            '--',
          ])
        ).stdout
          .split('\0')
          .filter(Boolean);
        verifyScope(delivery.changedPaths);
        delivery.preservationRef = ref;
      }
      return this.finish(operation, key, delivery);
    } catch (error) {
      return this.uncertain(operation, key, error);
    }
  }

  private lockOwner(path: string): {
    pid: number;
    nonce: string;
    runId: string;
    key: string;
  } {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
      throw new CrewError(
        'INVALID_LOCK',
        'Integration lock must be a small regular file',
      );
    let owner: {
      pid?: unknown;
      nonce?: unknown;
      runId?: unknown;
      key?: unknown;
    };
    try {
      owner = JSON.parse(readFileSync(path, 'utf8')) as typeof owner;
    } catch {
      throw new CrewError(
        'INVALID_LOCK',
        'Integration lock requires manual inspection',
      );
    }
    if (
      !owner ||
      !Number.isSafeInteger(owner.pid) ||
      Number(owner.pid) < 1 ||
      typeof owner.nonce !== 'string' ||
      typeof owner.runId !== 'string' ||
      typeof owner.key !== 'string'
    )
      throw new CrewError('INVALID_LOCK', 'Integration lock owner is invalid');
    return {
      pid: Number(owner.pid),
      nonce: owner.nonce,
      runId: owner.runId,
      key: owner.key,
    };
  }

  private serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    validate('Identifier', key);
    const execute = async () => {
      const lock = join(this.store.project.data_dir, 'integration.lock');
      const nonce = randomUUID();
      let fd: number;
      try {
        fd = openSync(lock, 'wx', 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new CrewError(
            'INTEGRATION_BUSY',
            'Integration is reserved; inspect/recover a dead owner before retrying',
            this.lockOwner(lock),
          );
        throw error;
      }
      let written = false;
      try {
        writeFileSync(
          fd,
          JSON.stringify({
            pid: process.pid,
            nonce,
            runId: this.actor.run_id,
            key,
          }),
        );
        written = true;
        return await action();
      } finally {
        closeSync(fd);
        if (!written || this.lockOwner(lock).nonce === nonce) unlinkSync(lock);
      }
    };
    const result = this.queue.then(execute, execute);
    this.queue = result.catch(() => undefined);
    return result;
  }

  recoverIntegrationLock(): void {
    // shortcut: one controller recovers a stopped service; add OS locking if recovery becomes concurrent.
    const lock = join(this.store.project.data_dir, 'integration.lock');
    if (!existsSync(lock)) return;
    const owner = this.lockOwner(lock);
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        unlinkSync(lock);
        return;
      }
      throw error;
    }
    throw new CrewError(
      'INTEGRATION_BUSY',
      'The integration owner is still alive',
    );
  }

  async prepareIntegration(
    request: {
      targetRef: string;
      expectedBase: string;
      deliveryOperationIds: readonly string[];
      checks: readonly Check[];
    },
    key: string,
  ): Promise<IntegrationCandidate> {
    if (!request.deliveryOperationIds.length || !request.checks.length)
      throw new CrewError(
        'INCOMPLETE_INTEGRATION',
        'Integration needs deliveries and candidate checks',
      );
    if (
      !request.targetRef.startsWith('refs/heads/') &&
      !request.targetRef.startsWith('refs/avity-crew/')
    )
      throw new CrewError('INVALID_REF', 'Use an explicit local delivery ref');
    await git(this.root, ['check-ref-format', request.targetRef]);
    return this.serial(key, async () => {
      const operation = this.open(key, 'integration.prepare', request);
      if (operation.status === 'completed')
        return operation.result as IntegrationCandidate;
      const previous = operation.result as IntegrationCandidate | null;
      if (operation.status === 'running' && previous?.type === 'integration') {
        await git(this.root, [
          'cat-file',
          '-e',
          `${sha(previous.candidateRevision)}^{commit}`,
        ]);
        return this.finish(operation, key, previous);
      }
      const path = join(
        this.store.project.data_dir,
        'integrations',
        digest(operation.id),
      );
      const candidateRef = `refs/heads/avity-crew/candidate-${digest(operation.id)}`;
      const base = sha(request.expectedBase);
      try {
        if (existsSync(path))
          throw new CrewError(
            'RECONCILIATION_REQUIRED',
            'Partial candidate is preserved; inspect it before another preparation',
            { operationId: operation.id, path },
          );
        await git(this.root, ['cat-file', '-e', `${base}^{commit}`]);
        const target = await git(
          this.root,
          ['rev-parse', '--verify', request.targetRef],
          true,
        );
        if (target.exitCode !== 0)
          await git(this.root, [
            'update-ref',
            request.targetRef,
            base,
            '0'.repeat(base.length),
          ]);
        else if (line(target.stdout) !== base)
          throw new CrewError(
            'TARGET_ADVANCED',
            'Delivery target no longer has the expected base',
          );
        const deliveries = request.deliveryOperationIds.map((id) =>
          this.result<Delivery>(id, 'workspace.collect', 'delivery'),
        );
        if (deliveries.some((delivery) => delivery.mode !== 'code'))
          throw new CrewError(
            'DOCUMENTARY_DELIVERY',
            'Documents do not require Git integration',
          );
        mkdirSync(join(this.store.project.data_dir, 'integrations'), {
          recursive: true,
          mode: 0o700,
        });
        await git(this.root, [
          'worktree',
          'add',
          '--no-track',
          '-b',
          candidateRef.slice(11),
          path,
          base,
        ]);
        const candidate: IntegrationCandidate = {
          type: 'integration',
          operationId: operation.id,
          status: 'validated',
          targetRef: request.targetRef,
          expectedBase: request.expectedBase,
          candidateRevision: request.expectedBase,
          candidateRef,
          path,
          deliveryOperationIds: request.deliveryOperationIds,
          proofs: [],
          conflicts: [],
        };
        for (const delivery of deliveries) {
          const source = sha(delivery.sourceRevision);
          if (
            line((await git(this.root, ['rev-parse', `${source}^`])).stdout) !==
            sha(delivery.baseRevision!)
          )
            throw new CrewError(
              'INVALID_DELIVERY',
              'Delivery is not the recorded immutable snapshot',
            );
          const cherry = await git(
            path,
            [
              '-c',
              'user.name=Avity Crew',
              '-c',
              'user.email=avity-crew@localhost',
              'cherry-pick',
              source,
            ],
            true,
          );
          if (cherry.exitCode !== 0) {
            candidate.status = 'conflict';
            candidate.conflicts = (
              await git(path, ['diff', '--name-only', '--diff-filter=U', '-z'])
            ).stdout
              .split('\0')
              .filter(Boolean);
            if (!candidate.conflicts.length)
              throw new CrewError(
                'INTEGRATION_FAILED',
                'Git refused the delivery without a merge conflict',
                redactSecrets(cherry.stderr),
              );
            break;
          }
        }
        candidate.candidateRevision = `git:${line((await git(path, ['rev-parse', 'HEAD'])).stdout)}`;
        if (candidate.status !== 'conflict') {
          for (const check of request.checks) {
            const startedAt = now();
            const observed = await runCommand(
              path,
              check.command,
              check.timeoutMs,
            );
            candidate.proofs.push({
              id: check.id,
              command: check.command,
              candidateRevision: candidate.candidateRevision,
              cwd: path,
              exitCode: observed.exitCode,
              signal: observed.signal,
              output: redactSecrets(
                observed.stdout + observed.stderr + (observed.error ?? ''),
              ),
              truncated: observed.truncated,
              startedAt,
              endedAt: now(),
            });
            if (observed.exitCode !== 0 || observed.signal || observed.error)
              candidate.status = 'validation_failed';
          }
          const state = await inspectRepository(path);
          if (
            state.head !== sha(candidate.candidateRevision) ||
            state.changes.length
          )
            candidate.status = 'validation_failed';
        }
        this.store.observeOperation(
          this.actor,
          operation.id,
          'running',
          candidate,
          stepKey(key, 'prepared'),
          this.version(),
        );
        return this.finish(operation, key, candidate);
      } catch (error) {
        return this.uncertain(operation, key, error);
      }
    });
  }

  async promoteIntegration(
    preparationOperationId: string,
    key: string,
  ): Promise<Promotion> {
    return this.serial(key, async () => {
      const candidate = this.result<IntegrationCandidate>(
        preparationOperationId,
        'integration.prepare',
        'integration',
      );
      if (
        candidate.status !== 'validated' ||
        !candidate.proofs.length ||
        candidate.proofs.some(
          (proof) =>
            proof.exitCode !== 0 ||
            proof.signal ||
            proof.candidateRevision !== candidate.candidateRevision,
        )
      )
        throw new CrewError(
          'UNVERIFIED_CANDIDATE',
          'Only the exact validated combination may be promoted',
        );
      const operation = this.open(key, 'integration.promote', {
        preparationOperationId,
      });
      if (operation.status === 'completed')
        return operation.result as Promotion;
      try {
        const target = line(
          (await git(this.root, ['rev-parse', '--verify', candidate.targetRef]))
            .stdout,
        );
        const wanted = sha(candidate.candidateRevision),
          expected = sha(candidate.expectedBase);
        if (target !== wanted) {
          if (target !== expected)
            throw new CrewError(
              'TARGET_ADVANCED',
              'The target changed; prepare and verify a new combination',
            );
          const worktrees = (
            await git(this.root, ['worktree', 'list', '--porcelain', '-z'])
          ).stdout.split('\0');
          if (worktrees.includes(`branch ${candidate.targetRef}`))
            throw new CrewError(
              'TARGET_CHECKED_OUT',
              'Use a dedicated non-checked-out delivery branch; the user worktree is preserved',
            );
          const current = line(
            (
              await git(this.root, [
                'rev-parse',
                '--verify',
                candidate.candidateRef,
              ])
            ).stdout,
          );
          if (current !== wanted)
            throw new CrewError(
              'CANDIDATE_CHANGED',
              'The candidate ref changed after verification',
            );
          await git(this.root, [
            'update-ref',
            candidate.targetRef,
            wanted,
            expected,
          ]);
        }
        return this.finish(operation, key, {
          type: 'promotion',
          operationId: operation.id,
          preparationOperationId,
          targetRef: candidate.targetRef,
          previousRevision: candidate.expectedBase,
          revision: candidate.candidateRevision,
        } satisfies Promotion);
      } catch (error) {
        return this.uncertain(operation, key, error);
      }
    });
  }

  async cleanupWorkspace(
    workspaceOperationId: string,
    deliveryOperationId: string,
    promotionOperationId: string,
    key: string,
  ): Promise<{ type: 'cleanup'; path: string }> {
    const workspace = this.result<WorkspaceHandle>(
      workspaceOperationId,
      'workspace.create',
      'workspace',
    );
    if (workspace.mode !== 'code')
      throw new CrewError(
        'USER_DIRECTORY',
        'Documentary and read-only directories are never removed',
      );
    if (
      !['exited', 'interrupted'].includes(
        this.store.getAttempt(workspace.attemptId).status,
      )
    )
      throw new CrewError(
        'ACTIVE_WORKSPACE',
        'Observe the worker process stopped before workspace cleanup',
      );
    const delivery = this.result<Delivery>(
      deliveryOperationId,
      'workspace.collect',
      'delivery',
    );
    const promotion = this.result<Promotion>(
      promotionOperationId,
      'integration.promote',
      'promotion',
    );
    const candidate = this.result<IntegrationCandidate>(
      promotion.preparationOperationId,
      'integration.prepare',
      'integration',
    );
    if (
      delivery.workspaceOperationId !== workspaceOperationId ||
      !candidate.deliveryOperationIds.includes(deliveryOperationId)
    )
      throw new CrewError(
        'NOT_INTEGRATED',
        'Cleanup requires the exact accepted delivery snapshot',
      );
    const operation = this.open(key, 'workspace.cleanup', {
      workspaceOperationId,
      deliveryOperationId,
      promotionOperationId,
    });
    if (operation.status === 'completed')
      return operation.result as { type: 'cleanup'; path: string };
    try {
      const target = line(
        (await git(this.root, ['rev-parse', promotion.targetRef])).stdout,
      );
      if (
        (
          await git(
            this.root,
            ['merge-base', '--is-ancestor', sha(promotion.revision), target],
            true,
          )
        ).exitCode !== 0
      )
        throw new CrewError(
          'NOT_INTEGRATED',
          'The promoted candidate is no longer retained by the target',
        );
      if (existsSync(workspace.path)) {
        const diff = await git(workspace.path, [
          'diff',
          '--name-only',
          '-z',
          sha(delivery.sourceRevision),
          '--',
        ]);
        const untracked = await git(workspace.path, [
          'ls-files',
          '--others',
          '-z',
        ]);
        if (diff.stdout || untracked.stdout)
          throw new CrewError(
            'UNPRESERVED_CHANGES',
            'Workspace contains later or unversioned work; keep it until snapshotted',
            { path: workspace.path },
          );
        const index = line((await git(workspace.path, ['write-tree'])).stdout);
        const snapshot = line(
          (
            await git(this.root, [
              'rev-parse',
              `${sha(delivery.sourceRevision)}^{tree}`,
            ])
          ).stdout,
        );
        if (index !== snapshot)
          throw new CrewError(
            'UNPRESERVED_INDEX',
            'Workspace index differs from the preserved snapshot',
          );
        await git(this.root, ['worktree', 'remove', '--force', workspace.path]);
      } else {
        const registered = (
          await git(this.root, ['worktree', 'list', '--porcelain', '-z'])
        ).stdout.split('\0');
        if (registered.includes(`worktree ${workspace.path}`))
          throw new CrewError(
            'RECONCILIATION_REQUIRED',
            'Missing workspace still has Git administrative state',
          );
      }
      return this.finish(operation, key, {
        type: 'cleanup',
        path: workspace.path,
      });
    } catch (error) {
      return this.uncertain(operation, key, error);
    }
  }
}
