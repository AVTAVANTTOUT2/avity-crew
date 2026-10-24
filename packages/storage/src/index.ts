import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  chmodSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  readFileSync,
  existsSync,
  lstatSync,
  realpathSync,
  readdirSync,
  copyFileSync,
  constants,
} from 'node:fs';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { CrewError, ident, now, validate } from '../../contracts/src/index.ts';
import type {
  Project,
  Run,
  TaskSpec,
  TaskState,
  Attempt,
  Actor,
  Handoff,
  CrewEvent,
  Decision,
  Message,
  AgentSession,
  Operation,
  ContextBundle,
  Workspace,
  SourceRef,
  Verification,
  ArtifactRef,
  Review,
  DelegateTaskArgs,
  PublishNoteArgs,
  ReportBlockerArgs,
  RequestUserInputArgs,
  AcceptDeliveryArgs,
  FinishRunArgs,
  Delegation,
  TaskNote,
  TaskBlocker,
  CoordinationQuestion,
  UserResponse,
  DecisionProvenance,
  DeliveryAcceptance,
  ProviderId,
} from '../../contracts/src/index.ts';
import {
  assertAcyclic,
  assertTransition,
  assertCurrentAttempt,
  assertRunTransition,
  assertRunCompletable,
} from '../../core/src/index.ts';
export { identifyProject, defaultConfig } from './project.ts';

const migrations = [
  `CREATE TABLE project (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
   CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id), status TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
   CREATE TABLE tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), status TEXT NOT NULL, generation INTEGER NOT NULL, active_attempt_id TEXT REFERENCES attempts(id) DEFERRABLE INITIALLY DEFERRED, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
   CREATE TABLE attempts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), task_id TEXT NOT NULL REFERENCES tasks(id), status TEXT NOT NULL, generation INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
   CREATE TABLE records (run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL, id TEXT NOT NULL, task_id TEXT REFERENCES tasks(id), actor_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(run_id, kind, id)) STRICT;
   CREATE TABLE events (run_id TEXT NOT NULL REFERENCES runs(id), seq INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(run_id, seq)) STRICT;
   CREATE TABLE requests (run_id TEXT NOT NULL REFERENCES runs(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL CHECK(json_valid(response)), PRIMARY KEY(run_id, key)) STRICT;`,
  `CREATE UNIQUE INDEX one_active_attempt ON attempts(task_id) WHERE status IN ('queued','running','unknown');
   CREATE INDEX tasks_by_run ON tasks(run_id, status);
   CREATE INDEX records_by_task ON records(run_id, task_id, kind);`,
];

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => JSON.stringify(key) + ':' + canonical(entry))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}

export function redactSecrets(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .replace(
      /((?:password|api[_-]?key|access[_-]?token|secret|token)\s*[=:]\s*["']?)[^\s"',;]+/gi,
      '$1[REDACTED]',
    );
}

type RecordKind =
  | 'decision'
  | 'message'
  | 'session'
  | 'handoff'
  | 'context'
  | 'source'
  | 'note'
  | 'workspace'
  | 'operation'
  | 'artifact'
  | 'verification'
  | 'review'
  | 'question'
  | 'user_response'
  | 'delegation'
  | 'blocker'
  | 'acceptance'
  | 'final';
type Row = { data: string };

export class Store {
  private readonly db: DatabaseSync;
  readonly project: Project;
  readonly filename: string;

  constructor(project: Project) {
    mkdirSync(project.data_dir, { recursive: true, mode: 0o700 });
    chmodSync(project.data_dir, 0o700);
    this.filename = join(project.data_dir, 'state.sqlite');
    this.db = new DatabaseSync(this.filename);
    chmodSync(this.filename, 0o600);
    this.db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;',
    );
    try {
      this.migrate();
      this.project = this.transaction(() => {
        const row = this.db.prepare('SELECT id, data FROM project').get();
        if (row && row['id'] !== project.id)
          throw new CrewError(
            'PROJECT_MISMATCH',
            'Database belongs to another project',
          );
        const current = row
          ? {
              ...(JSON.parse(String(row['data'])) as Project),
              root: project.root,
              git_common_dir: project.git_common_dir,
              data_dir: project.data_dir,
            }
          : project;
        if (!row)
          this.db
            .prepare('INSERT INTO project(id,data) VALUES (?,?)')
            .run(project.id, JSON.stringify(current));
        else
          this.db
            .prepare('UPDATE project SET data=? WHERE id=?')
            .run(JSON.stringify(current), project.id);
        return current;
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.transaction(() => {
      const version = Number(
        this.db.prepare('PRAGMA user_version').get()?.['user_version'],
      );
      if (
        !Number.isSafeInteger(version) ||
        version < 0 ||
        version > migrations.length
      )
        throw new CrewError(
          'INCOMPATIBLE_DATABASE',
          `Unsupported database version ${version}`,
        );
      for (let index = version; index < migrations.length; index++) {
        this.db.exec(migrations[index]!);
        this.db.exec(`PRAGMA user_version=${index + 1}`);
      }
    });
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private decode<T>(row: unknown, label: string): T {
    if (!row) throw new CrewError('NOT_FOUND', `${label} not found`);
    return JSON.parse((row as Row).data) as T;
  }

  getRun(id: string): Run {
    return this.decode<Run>(
      this.db
        .prepare('SELECT data FROM runs WHERE id=? AND project_id=?')
        .get(id, this.project.id),
      'Run',
    );
  }
  listRuns(limit = 50): Run[] {
    this.limit(limit);
    return this.db
      .prepare(
        'SELECT data FROM runs WHERE project_id=? ORDER BY rowid DESC LIMIT ?',
      )
      .all(this.project.id, limit)
      .map((row) => this.decode<Run>(row, 'Run'));
  }
  getTask(id: string): TaskState {
    return this.decode<TaskState>(
      this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id),
      'Task',
    );
  }
  tasks(runId: string): TaskState[] {
    this.getRun(runId);
    return this.db
      .prepare('SELECT data FROM tasks WHERE run_id=? ORDER BY rowid')
      .all(runId)
      .map((row) => this.decode<TaskState>(row, 'Task'));
  }
  getAttempt(id: string): Attempt {
    return this.decode<Attempt>(
      this.db.prepare('SELECT data FROM attempts WHERE id=?').get(id),
      'Attempt',
    );
  }
  attempts(runId: string): Attempt[] {
    this.getRun(runId);
    return this.db
      .prepare('SELECT data FROM attempts WHERE run_id=? ORDER BY rowid')
      .all(runId)
      .map((row) => this.decode<Attempt>(row, 'Attempt'));
  }
  private limit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new CrewError('INVALID_LIMIT', 'Limit must be between 1 and 1000');
  }
  events(runId: string, afterSeq = 0, limit = 100): CrewEvent[] {
    this.getRun(runId);
    this.limit(limit);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0)
      throw new CrewError('INVALID_CURSOR', 'Invalid event cursor');
    return this.db
      .prepare(
        'SELECT data FROM events WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?',
      )
      .all(runId, afterSeq, limit)
      .map((row) => this.decode<CrewEvent>(row, 'Event'));
  }
  getRecord<T>(runId: string, kind: RecordKind, id: string): T {
    this.getRun(runId);
    return this.decode<T>(
      this.db
        .prepare('SELECT data FROM records WHERE run_id=? AND kind=? AND id=?')
        .get(runId, kind, id),
      kind,
    );
  }
  records<T>(runId: string, kind: RecordKind, limit = 1000): T[] {
    this.getRun(runId);
    this.limit(limit);
    return this.db
      .prepare(
        'SELECT data FROM records WHERE run_id=? AND kind=? ORDER BY rowid LIMIT ?',
      )
      .all(runId, kind, limit)
      .map((row) => this.decode<T>(row, kind));
  }

  private writeTask(task: TaskState): void {
    this.db
      .prepare(
        'UPDATE tasks SET status=?,generation=?,active_attempt_id=?,data=? WHERE id=? AND run_id=?',
      )
      .run(
        task.status,
        task.generation,
        task.active_attempt_id,
        JSON.stringify(task),
        task.id,
        task.run_id,
      );
  }
  private writeAttempt(attempt: Attempt): void {
    this.db
      .prepare('UPDATE attempts SET status=?,generation=?,data=? WHERE id=?')
      .run(
        attempt.status,
        attempt.generation,
        JSON.stringify(attempt),
        attempt.id,
      );
  }
  private writeRecord(
    actor: Actor,
    kind: RecordKind,
    value: { id: string },
    taskId: string | null = null,
  ): void {
    validate('Identifier', value.id);
    if (taskId && this.getTask(taskId).run_id !== actor.run_id)
      throw new CrewError('WRONG_RUN', 'Record task belongs to another run');
    this.db
      .prepare(
        'INSERT INTO records(run_id,kind,id,task_id,actor_id,data) VALUES (?,?,?,?,?,?)',
      )
      .run(
        actor.run_id,
        kind,
        value.id,
        taskId,
        actor.id,
        JSON.stringify(value),
      );
  }
  private authority(actor: Actor, roles: readonly Actor['role'][]): Run {
    const run = this.getRun(actor.run_id);
    if (actor.project_id !== this.project.id || !roles.includes(actor.role))
      throw new CrewError(
        'FORBIDDEN',
        'Action is not allowed for this project and role',
      );
    if (actor.role === 'chief' && actor.generation !== run.generation)
      throw new CrewError(
        'STALE_AUTHORITY',
        'Chief authority has been revoked',
      );
    if (
      !['user', 'chief'].includes(actor.role) &&
      (!actor.task_id || !actor.attempt_id)
    )
      throw new CrewError(
        'FORBIDDEN',
        'Worker identity requires an assigned attempt',
      );
    if (actor.task_id) {
      const task = this.getTask(actor.task_id);
      if (
        task.run_id !== run.id ||
        task.active_attempt_id !== actor.attempt_id ||
        task.generation !== actor.generation
      )
        throw new CrewError('STALE_ATTEMPT', 'Task authority has been revoked');
    }
    return run;
  }
  private openRun(actor: Actor, roles: readonly Actor['role'][]): Run {
    const run = this.authority(actor, roles);
    if (['completed', 'cancelled', 'failed'].includes(run.status))
      throw new CrewError('RUN_TERMINAL', 'The run no longer accepts new work');
    return run;
  }
  private replaceRecord(
    runId: string,
    kind: RecordKind,
    value: { id: string },
  ): void {
    this.db
      .prepare('UPDATE records SET data=? WHERE run_id=? AND kind=? AND id=?')
      .run(JSON.stringify(value), runId, kind, value.id);
  }
  private scopedSources(actor: Actor, sourceIds: readonly string[]): void {
    for (const id of sourceIds)
      this.getRecord<SourceRef>(actor.run_id, 'source', id);
  }
  private moveTask(task: TaskState, status: TaskState['status']): void {
    if (task.status !== status) {
      assertTransition(task.status, status);
      task.status = status;
      task.version++;
      this.writeTask(task);
    }
  }

  private assignedWorker(
    actor: Actor,
    taskId = actor.task_id,
  ): { task: TaskState; attempt: Attempt } {
    this.openRun(actor, [
      'developer',
      'reviewer',
      'validator',
      'documenter',
      'investigator',
      'refactorer',
      'ci',
    ]);
    if (!taskId || taskId !== actor.task_id || !actor.attempt_id)
      throw new CrewError('FORBIDDEN', 'Worker action belongs to its own task');
    const task = this.getTask(taskId),
      attempt = this.getAttempt(actor.attempt_id);
    if (
      task.spec.role !== actor.role ||
      attempt.task_id !== task.id ||
      attempt.run_id !== actor.run_id ||
      !['running', 'exited'].includes(attempt.status) ||
      ['accepted', 'cancelled'].includes(task.status)
    )
      throw new CrewError(
        'INACTIVE_ATTEMPT',
        'Worker assignment is not active',
      );
    return { task, attempt };
  }

  private allRecords<T>(runId: string, kind: RecordKind): T[] {
    return this.db
      .prepare(
        'SELECT data FROM records WHERE run_id=? AND kind=? ORDER BY rowid',
      )
      .all(runId, kind)
      .map((row) => this.decode<T>(row, kind));
  }

  private blockingQuestions(
    runId: string,
    taskId?: string,
  ): CoordinationQuestion[] {
    return this.allRecords<CoordinationQuestion>(runId, 'question').filter(
      (question) =>
        question.status === 'open' &&
        question.blocking &&
        (taskId === undefined || question.affects_task_ids.includes(taskId)),
    );
  }

  private currentHandoff(runId: string, taskId: string): Handoff {
    const row = this.db
      .prepare(
        "SELECT data FROM records WHERE run_id=? AND kind='handoff' AND task_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(runId, taskId);
    return this.decode<Handoff>(row, 'Current handoff');
  }

  private storedOperation<T>(runId: string, id: string, kind: string): T {
    const operation = this.getRecord<Operation>(runId, 'operation', id);
    if (
      operation.kind !== kind ||
      operation.status !== 'completed' ||
      operation.result === null ||
      typeof operation.result !== 'object'
    )
      throw new CrewError(
        'INVALID_INTEGRATION',
        'Integration operation is incomplete or has another kind',
      );
    return operation.result as T;
  }

  private sourceDelivery(
    runId: string,
    handoff: Handoff,
    ids: readonly string[],
  ): { preservationRef: string | null; sourceRevision: string } {
    for (const id of ids) {
      const delivery = this.storedOperation<{
        type: string;
        operationId: string;
        workspaceOperationId: string;
        sourceRevision: string;
        preservationRef: string | null;
      }>(runId, id, 'workspace.collect');
      if (
        delivery.type !== 'delivery' ||
        delivery.operationId !== id ||
        delivery.sourceRevision !== handoff.source_revision
      )
        continue;
      const workspace = this.storedOperation<{
        type: string;
        operationId: string;
        taskId: string;
        attemptId: string;
      }>(runId, delivery.workspaceOperationId, 'workspace.create');
      if (
        workspace.type === 'workspace' &&
        workspace.operationId === delivery.workspaceOperationId &&
        workspace.taskId === handoff.task_id &&
        workspace.attemptId === handoff.attempt_id &&
        typeof delivery.preservationRef === 'string'
      )
        return delivery;
    }
    throw new CrewError(
      'INVALID_INTEGRATION',
      'Candidate does not contain this task attempt delivery',
    );
  }

  private preparedIntegration(
    runId: string,
    handoff: Handoff,
    revision: string,
    promotionRequired: boolean,
  ): {
    delivery: { preservationRef: string | null; sourceRevision: string };
    proofs: {
      command: readonly string[];
      cwd: string;
      exitCode: number | null;
      signal: string | null;
      candidateRevision: string;
    }[];
  } {
    const operations = this.allRecords<Operation>(runId, 'operation');
    for (const operation of operations) {
      if (
        operation.kind !== 'integration.prepare' ||
        operation.status !== 'completed'
      )
        continue;
      const candidate = operation.result as {
        type?: string;
        operationId?: string;
        status?: string;
        candidateRevision?: string;
        targetRef?: string;
        expectedBase?: string;
        deliveryOperationIds?: string[];
        proofs?: {
          command: readonly string[];
          cwd: string;
          exitCode: number | null;
          signal: string | null;
          candidateRevision: string;
        }[];
      } | null;
      if (
        !candidate ||
        candidate.type !== 'integration' ||
        candidate.operationId !== operation.id ||
        candidate.status !== 'validated' ||
        candidate.candidateRevision !== revision ||
        typeof candidate.targetRef !== 'string' ||
        typeof candidate.expectedBase !== 'string' ||
        !Array.isArray(candidate.deliveryOperationIds) ||
        !candidate.deliveryOperationIds.length ||
        !Array.isArray(candidate.proofs) ||
        !candidate.proofs.length ||
        candidate.proofs.some(
          (proof) =>
            !proof ||
            !Array.isArray(proof.command) ||
            !proof.command.length ||
            typeof proof.cwd !== 'string' ||
            proof.exitCode !== 0 ||
            proof.signal !== null ||
            proof.candidateRevision !== revision,
        )
      )
        continue;
      let delivery: { preservationRef: string | null; sourceRevision: string };
      try {
        delivery = this.sourceDelivery(
          runId,
          handoff,
          candidate.deliveryOperationIds,
        );
      } catch (error) {
        if (error instanceof CrewError) continue;
        throw error;
      }
      if (
        promotionRequired &&
        !operations.some((promoted) => {
          if (
            promoted.kind !== 'integration.promote' ||
            promoted.status !== 'completed'
          )
            return false;
          const result = promoted.result as {
            type?: string;
            operationId?: string;
            preparationOperationId?: string;
            revision?: string;
            targetRef?: string;
            previousRevision?: string;
          } | null;
          return (
            result?.type === 'promotion' &&
            result.operationId === promoted.id &&
            result.preparationOperationId === operation.id &&
            result.revision === revision &&
            result.targetRef === candidate.targetRef &&
            result.previousRevision === candidate.expectedBase
          );
        })
      )
        continue;
      return { delivery, proofs: candidate.proofs };
    }
    throw new CrewError(
      'INTEGRATION_REQUIRED',
      promotionRequired
        ? 'Exact validated integration and observed promotion are required'
        : 'Exact validated integration is required',
    );
  }

  private checkedProof(
    runId: string,
    id: string,
    revision: string,
  ): Verification {
    const proof = this.getRecord<Verification>(runId, 'verification', id);
    validate('Verification', proof);
    if (
      proof.result !== 'passed' ||
      proof.tested_revision !== revision ||
      proof.ended_at === null ||
      !proof.evidence_artifact_ids.length ||
      (proof.command === null
        ? proof.execution !== 'manual' || proof.exit_code !== null
        : proof.exit_code !== 0)
    )
      throw new CrewError(
        'INVALID_EVIDENCE',
        'Verification must pass on the exact revision with an observation artifact',
      );
    for (const artifactId of proof.evidence_artifact_ids)
      this.checkedArtifact(runId, artifactId);
    return proof;
  }

  private checkedArtifact(runId: string, id: string): ArtifactRef {
    const artifact = this.getRecord<ArtifactRef>(runId, 'artifact', id);
    validate('ArtifactRef', artifact);
    if (artifact.revision.startsWith('sha256:')) this.readArtifact(artifact);
    else if (artifact.kind !== 'git_commit')
      throw new CrewError(
        'INVALID_ARTIFACT',
        'Git artifact must be an immutable commit',
      );
    return artifact;
  }

  private deliveryCheck(
    actor: Actor,
    args: AcceptDeliveryArgs,
    promotionRequired: boolean,
  ): {
    task: TaskState;
    handoff: Handoff;
    proofs: Verification[];
    artifactIds: string[];
    existing: DeliveryAcceptance | undefined;
  } {
    validate('AcceptDeliveryArgs', args);
    const run = this.openRun(actor, ['user', 'chief']);
    const handoff = this.getRecord<Handoff>(run.id, 'handoff', args.handoff_id),
      task = this.getTask(handoff.task_id),
      attempt = this.getAttempt(handoff.attempt_id);
    const existing = this.allRecords<DeliveryAcceptance>(
      run.id,
      'acceptance',
    ).find(
      (record) =>
        record.task_id === task.id &&
        record.handoff_id === handoff.id &&
        record.accepted_revision === args.accepted_revision,
    );
    if (
      task.run_id !== run.id ||
      this.currentHandoff(run.id, task.id).id !== handoff.id ||
      task.active_attempt_id !== attempt.id ||
      task.generation !== handoff.generation ||
      attempt.generation !== handoff.generation ||
      !['exited', 'interrupted'].includes(attempt.status)
    )
      throw new CrewError(
        'STALE_DELIVERY',
        'Delivery is not current or its writer has not stopped',
      );
    if (
      !['in_review', 'validating'].includes(task.status) &&
      !(task.status === 'accepted' && existing)
    )
      throw new CrewError(
        'INVALID_TRANSITION',
        'Task is not ready for acceptance',
      );
    if (
      handoff.status !== 'delivered' ||
      handoff.limitations.length ||
      !handoff.source_revision ||
      !handoff.artifacts.length ||
      this.blockingQuestions(run.id, task.id).length
    )
      throw new CrewError(
        'INCOMPLETE_DELIVERY',
        'Delivery is partial, limited, empty or waiting for a user answer',
      );
    const required = task.spec.acceptance_criteria
      .filter((criterion) => criterion.required)
      .map((criterion) => criterion.id);
    if (required.some((id) => !handoff.criteria_claimed.includes(id)))
      throw new CrewError(
        'MISSING_CRITERIA',
        'Delivery does not claim every required task criterion',
      );
    const proofs = [...new Set(args.verification_ids)].map((id) =>
      this.checkedProof(run.id, id, args.accepted_revision),
    );
    for (const proof of proofs) {
      const record = this.db
        .prepare(
          'SELECT task_id FROM records WHERE run_id=? AND kind=? AND id=?',
        )
        .get(run.id, 'verification', proof.id);
      if (record?.['task_id'] !== task.id)
        throw new CrewError(
          'INVALID_EVIDENCE',
          'Verification belongs to another task',
        );
    }
    if (
      !proofs.length ||
      required.some(
        (id) => !proofs.some((proof) => proof.criterion_ids.includes(id)),
      )
    )
      throw new CrewError(
        'MISSING_EVIDENCE',
        'Required task criteria lack passing proofs',
      );
    if (!args.review_ids.length)
      throw new CrewError(
        'REVIEW_REQUIRED',
        'Independent approved review is required',
      );
    const code = run.delivery_mode === 'code';
    for (const id of new Set(args.review_ids)) {
      const review = this.getRecord<Review>(run.id, 'review', id);
      if (
        review.outcome !== 'approved' ||
        review.findings.some((finding) => finding.severity === 'blocking') ||
        review.handoff_id !== handoff.id ||
        review.review_of_task_id !== task.id ||
        review.source_revision !== handoff.source_revision ||
        review.tested_revision !== args.accepted_revision ||
        review.verification_scope !==
          (code ? 'combined_code' : 'documentation') ||
        review.verification_ids.some(
          (proofId) => !args.verification_ids.includes(proofId),
        )
      )
        throw new CrewError(
          'INVALID_REVIEW',
          'Review must approve this exact delivery and accepted revision',
        );
    }
    const artifacts = handoff.artifacts.map((artifact) => {
      const stored = this.checkedArtifact(run.id, artifact.id);
      if (
        canonical(stored) !== canonical(artifact) ||
        artifact.producer_attempt_id !== attempt.id
      )
        throw new CrewError(
          'INVALID_ARTIFACT',
          'Delivery artifact metadata or producer is inconsistent',
        );
      return stored;
    });
    if (code) {
      if (
        !handoff.source_revision.startsWith('git:') ||
        !args.accepted_revision.startsWith('git:')
      )
        throw new CrewError(
          'INVALID_REVISION',
          'Code acceptance requires Git revisions',
        );
      const prepared = this.preparedIntegration(
        run.id,
        handoff,
        args.accepted_revision,
        promotionRequired,
      );
      if (
        !proofs.some(
          (proof) => proof.execution === 'automated' && proof.command !== null,
        )
      )
        throw new CrewError(
          'INVALID_EVIDENCE',
          'Code acceptance requires an observed automated candidate check',
        );
      for (const artifact of artifacts.filter((item) =>
        item.revision.startsWith('git:'),
      ))
        if (
          artifact.revision !== prepared.delivery.sourceRevision ||
          artifact.reference !== prepared.delivery.preservationRef
        )
          throw new CrewError(
            'INVALID_ARTIFACT',
            'Git artifact does not identify the recorded source snapshot',
          );
      if (
        !artifacts.some(
          (artifact) =>
            artifact.kind === 'git_commit' &&
            artifact.revision === handoff.source_revision,
        )
      )
        throw new CrewError(
          'INVALID_ARTIFACT',
          'Code delivery lacks its immutable Git source artifact',
        );
      for (const proof of proofs.filter((item) => item.command !== null))
        if (
          !prepared.proofs.some(
            (observed) =>
              canonical(observed.command) === canonical(proof.command) &&
              observed.cwd === proof.cwd &&
              observed.candidateRevision === proof.tested_revision &&
              observed.exitCode === proof.exit_code,
          )
        )
          throw new CrewError(
            'INVALID_EVIDENCE',
            'Automated proof is not an observed check of the prepared candidate',
          );
    } else {
      if (
        !args.accepted_revision.startsWith('sha256:') ||
        handoff.source_revision !== args.accepted_revision
      )
        throw new CrewError(
          'INVALID_REVISION',
          'Documentation acceptance uses its exact snapshot hash',
        );
      this.readArtifact({
        reference: `artifacts/${args.accepted_revision.slice(7)}`,
        revision: args.accepted_revision,
      });
      if (artifacts.some((artifact) => artifact.revision.startsWith('git:')))
        throw new CrewError(
          'INVALID_ARTIFACT',
          'Documentary delivery does not require artificial Git artifacts',
        );
    }
    const artifactIds = [
      ...new Set([
        ...artifacts.map((artifact) => artifact.id),
        ...proofs.flatMap((proof) => proof.evidence_artifact_ids),
      ]),
    ];
    return { task, handoff, proofs, artifactIds, existing };
  }

  private append(
    runId: string,
    actor: Actor,
    type: string,
    payload: Record<string, unknown>,
    correlation: Partial<
      Pick<CrewEvent, 'task_id' | 'attempt_id' | 'session_id' | 'generation'>
    > = {},
  ): CrewEvent {
    const seq = Number(
      this.db
        .prepare(
          'SELECT COALESCE(MAX(seq),0)+1 AS seq FROM events WHERE run_id=?',
        )
        .get(runId)?.['seq'],
    );
    const event: CrewEvent = {
      schema_version: 1,
      id: ident('event'),
      seq,
      type,
      project_id: this.project.id,
      run_id: runId,
      task_id: actor.task_id,
      session_id: null,
      attempt_id: actor.attempt_id,
      generation: actor.generation,
      actor_id: actor.id,
      occurred_at: now(),
      payload: JSON.parse(redactSecrets(JSON.stringify(payload))) as Record<
        string,
        unknown
      >,
      ...correlation,
    };
    validate('CrewEvent', event);
    this.db
      .prepare('INSERT INTO events(run_id,seq,data) VALUES (?,?,?)')
      .run(runId, seq, JSON.stringify(event));
    return event;
  }
  private mutate<T extends { id: string }>(
    actor: Actor,
    key: string,
    method: string,
    input: unknown,
    expectedVersion: number,
    action: (run: Run) => T,
  ): T {
    validate('Identifier', key);
    const fingerprint = createHash('sha256')
      .update(canonical({ actor, method, input }))
      .digest('hex');
    return this.transaction(() => {
      const run = this.getRun(actor.run_id);
      this.authority(actor, [
        'user',
        'chief',
        'developer',
        'reviewer',
        'validator',
        'documenter',
        'investigator',
        'refactorer',
        'ci',
      ]);
      const previous = this.db
        .prepare(
          'SELECT fingerprint,response FROM requests WHERE run_id=? AND key=?',
        )
        .get(run.id, key);
      if (previous) {
        if (previous['fingerprint'] !== fingerprint)
          throw new CrewError(
            'IDEMPOTENCY_CONFLICT',
            'The key was already used for another operation',
          );
        return JSON.parse(String(previous['response'])) as T;
      }
      if (run.version !== expectedVersion)
        throw new CrewError(
          'VERSION_CONFLICT',
          `Expected run version ${expectedVersion}, current ${run.version}`,
        );
      const result = action(run);
      run.version++;
      run.updated_at = now();
      this.db
        .prepare('UPDATE runs SET version=?,status=?,data=? WHERE id=?')
        .run(run.version, run.status, JSON.stringify(run), run.id);
      const target = result as T &
        Partial<{
          task_id: string;
          attempt_id: string;
          session_id: string;
          generation: number;
          active_attempt_id: string | null;
        }>;
      const attemptId =
        method === 'task.claimed' || method === 'attempt.observed'
          ? result.id
          : (target.attempt_id ?? target.active_attempt_id ?? actor.attempt_id);
      this.append(
        run.id,
        actor,
        method,
        { request_key: key, subject_id: result.id },
        {
          task_id:
            target.task_id ??
            (method.startsWith('task.') ? result.id : actor.task_id),
          attempt_id: attemptId,
          session_id:
            target.session_id ??
            (method === 'session.observed' ||
            method === 'chief.session_registered'
              ? result.id
              : attemptId
                ? this.getAttempt(attemptId).session_id
                : null),
          generation:
            target.generation && target.generation > 0
              ? target.generation
              : actor.generation,
        },
      );
      this.db
        .prepare(
          'INSERT INTO requests(run_id,key,fingerprint,response) VALUES (?,?,?,?)',
        )
        .run(run.id, key, fingerprint, JSON.stringify(result));
      return result;
    });
  }

  createRun(run: Run, key: string): Run {
    validate('Identifier', run.id);
    validate('Identifier', key);
    if (
      run.project_id !== this.project.id ||
      !run.objective.trim() ||
      !run.acceptance_criteria.length ||
      run.status !== 'planning' ||
      run.version !== 0 ||
      !Number.isSafeInteger(run.max_active_agents) ||
      run.max_active_agents < 1 ||
      run.generation !== 1
    )
      throw new CrewError('INVALID_RUN', 'Invalid initial run');
    for (const criterion of run.acceptance_criteria)
      validate('Criterion', criterion);
    const actor: Actor = {
      id: 'user:local',
      project_id: this.project.id,
      run_id: run.id,
      role: 'user',
      task_id: null,
      attempt_id: null,
      generation: 1,
    };
    return this.transaction(() => {
      const fingerprint = createHash('sha256')
        .update(canonical(run))
        .digest('hex');
      const existing = this.db
        .prepare(
          'SELECT fingerprint,response FROM requests WHERE run_id=? AND key=?',
        )
        .get(run.id, key);
      if (existing) {
        if (existing['fingerprint'] !== fingerprint)
          throw new CrewError(
            'IDEMPOTENCY_CONFLICT',
            'Run creation key conflicts',
          );
        return JSON.parse(String(existing['response'])) as Run;
      }
      this.db
        .prepare(
          'INSERT INTO runs(id,project_id,status,version,data) VALUES (?,?,?,?,?)',
        )
        .run(
          run.id,
          run.project_id,
          run.status,
          run.version,
          JSON.stringify(run),
        );
      this.append(run.id, actor, 'run.created', { objective: run.objective });
      this.db
        .prepare('INSERT INTO requests VALUES (?,?,?,?)')
        .run(run.id, key, fingerprint, JSON.stringify(run));
      return run;
    });
  }

  createTask(
    actor: Actor,
    spec: TaskSpec,
    key: string,
    expectedVersion: number,
  ): TaskState {
    validate('TaskSpec', spec);
    return this.mutate(
      actor,
      key,
      'task.created',
      spec,
      expectedVersion,
      () => {
        this.openRun(actor, ['user', 'chief']);
        if (spec.run_id !== actor.run_id)
          throw new CrewError('WRONG_RUN', 'Task belongs to another run');
        const tasks = this.tasks(actor.run_id);
        assertAcyclic(
          new Map([
            ...tasks.map((task) => [task.id, task.spec.depends_on] as const),
            [spec.id, spec.depends_on],
          ]),
        );
        const ready = spec.depends_on.every(
          (id) => this.getTask(id).status === 'accepted',
        );
        const task: TaskState = {
          id: spec.id,
          run_id: spec.run_id,
          spec,
          status: ready ? 'ready' : 'waiting_dependency',
          generation: 0,
          active_attempt_id: null,
          version: 0,
          wait_reason: ready ? null : 'Dependencies are not accepted',
          accepted_revision: null,
        };
        this.db
          .prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?)')
          .run(
            task.id,
            task.run_id,
            task.status,
            task.generation,
            null,
            JSON.stringify(task),
          );
        return task;
      },
    );
  }

  claimTask(
    actor: Actor,
    taskId: string,
    session: AgentSession,
    key: string,
    expectedVersion: number,
  ): Attempt {
    return this.mutate(
      actor,
      key,
      'task.claimed',
      { taskId, session },
      expectedVersion,
      () => {
        this.openRun(actor, ['user', 'chief']);
        const task = this.getTask(taskId);
        if (
          task.run_id !== actor.run_id ||
          session.run_id !== task.run_id ||
          session.task_id !== task.id
        )
          throw new CrewError(
            'WRONG_RUN',
            'Session or task does not match run',
          );
        if (
          this.blockingQuestions(actor.run_id, task.id).length ||
          task.active_attempt_id ||
          task.status !== 'ready' ||
          task.spec.depends_on.some(
            (id) => this.getTask(id).status !== 'accepted',
          )
        )
          throw new CrewError(
            'TASK_NOT_READY',
            'Task is already owned or has unavailable dependencies',
          );
        validate('ProviderId', session.provider);
        const delegation = this.allRecords<Delegation>(
          actor.run_id,
          'delegation',
        ).find((item) => item.task_id === task.id && item.status === 'queued');
        if (
          delegation &&
          (delegation.provider !== session.provider ||
            delegation.model !== session.model)
        )
          throw new CrewError(
            'DELEGATION_MISMATCH',
            'Claim must use the delegated provider and model',
          );
        const started = now();
        const attempt: Attempt = {
          id: ident('attempt'),
          task_id: task.id,
          run_id: task.run_id,
          session_id: session.id,
          generation: task.generation + 1,
          status: 'queued',
          started_at: started,
          heartbeat_at: started,
          ended_at: null,
          exit_code: null,
          pid: null,
        };
        this.writeRecord(actor, 'session', session, task.id);
        this.db
          .prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?)')
          .run(
            attempt.id,
            attempt.run_id,
            attempt.task_id,
            attempt.status,
            attempt.generation,
            JSON.stringify(attempt),
          );
        assertTransition(task.status, 'running');
        task.status = 'running';
        task.generation = attempt.generation;
        task.active_attempt_id = attempt.id;
        task.version++;
        this.writeTask(task);
        if (delegation) {
          delegation.status = 'claimed';
          delegation.attempt_id = attempt.id;
          this.replaceRecord(actor.run_id, 'delegation', delegation);
        }
        return attempt;
      },
    );
  }

  observeAttempt(
    actor: Actor,
    id: string,
    observation: {
      status: Attempt['status'];
      pid: number | null;
      exit_code: number | null;
    },
    key: string,
    expectedVersion: number,
  ): Attempt {
    return this.mutate(
      actor,
      key,
      'attempt.observed',
      { id, observation },
      expectedVersion,
      () => {
        this.authority(actor, ['user']);
        const attempt = this.getAttempt(id);
        if (attempt.run_id !== actor.run_id)
          throw new CrewError('WRONG_RUN', 'Attempt belongs to another run');
        if (['exited', 'interrupted'].includes(attempt.status))
          throw new CrewError(
            'TERMINAL_ATTEMPT',
            'Attempt is already terminal',
          );
        if (observation.status === 'queued')
          throw new CrewError(
            'INVALID_TRANSITION',
            'Attempt cannot be observed as queued again',
          );
        Object.assign(attempt, observation);
        attempt.heartbeat_at = now();
        if (['exited', 'interrupted'].includes(attempt.status))
          attempt.ended_at = now();
        this.writeAttempt(attempt);
        return attempt;
      },
    );
  }

  reassignTask(
    actor: Actor,
    taskId: string,
    key: string,
    expectedVersion: number,
  ): TaskState {
    return this.mutate(
      actor,
      key,
      'task.revoked',
      { taskId },
      expectedVersion,
      () => {
        this.openRun(actor, ['user', 'chief']);
        const task = this.getTask(taskId);
        if (
          task.run_id !== actor.run_id ||
          task.status === 'accepted' ||
          task.status === 'cancelled'
        )
          throw new CrewError(
            'INVALID_TRANSITION',
            'Task cannot be reassigned',
          );
        if (
          task.active_attempt_id &&
          !['exited', 'interrupted'].includes(
            this.getAttempt(task.active_attempt_id).status,
          )
        )
          throw new CrewError(
            'RECONCILIATION_REQUIRED',
            'Observe previous process termination before reassignment',
          );
        task.generation++;
        task.active_attempt_id = null;
        task.status = task.spec.depends_on.every(
          (id) => this.getTask(id).status === 'accepted',
        )
          ? 'ready'
          : 'waiting_dependency';
        task.version++;
        this.writeTask(task);
        return task;
      },
    );
  }

  submitHandoff(
    actor: Actor,
    handoff: Handoff,
    key: string,
    expectedVersion = this.getRun(actor.run_id).version,
  ): Handoff {
    validate('Handoff', handoff);
    return this.mutate(
      actor,
      key,
      'handoff.submitted',
      handoff,
      expectedVersion,
      () => {
        this.openRun(actor, [
          'developer',
          'reviewer',
          'validator',
          'documenter',
          'investigator',
          'refactorer',
          'ci',
        ]);
        const task = this.getTask(handoff.task_id),
          attempt = this.getAttempt(handoff.attempt_id);
        if (
          actor.task_id !== task.id ||
          actor.attempt_id !== attempt.id ||
          actor.generation !== attempt.generation
        )
          throw new CrewError('FORBIDDEN', 'Cannot submit for another attempt');
        assertCurrentAttempt(handoff, attempt, task);
        const criteria = new Set(
          task.spec.acceptance_criteria.map((criterion) => criterion.id),
        );
        const artifactIds = new Set(
          handoff.artifacts.map((artifact) => artifact.id),
        );
        if (
          handoff.criteria_claimed.some((id) => !criteria.has(id)) ||
          handoff.verifications.some(
            (proof) =>
              proof.criterion_ids.some((id) => !criteria.has(id)) ||
              proof.evidence_artifact_ids.some((id) => !artifactIds.has(id)),
          )
        )
          throw new CrewError(
            'INVALID_EVIDENCE',
            'Evidence references an unrelated criterion or artifact',
          );
        for (const artifact of handoff.artifacts)
          this.writeRecord(actor, 'artifact', artifact, task.id);
        this.writeRecord(actor, 'handoff', handoff, task.id);
        task.status = handoff.status === 'delivered' ? 'in_review' : 'blocked';
        task.version++;
        this.writeTask(task);
        return handoff;
      },
    );
  }

  recordDecision(
    actor: Actor,
    decision: Decision,
    key: string,
    expectedVersion: number,
    provenance: DecisionProvenance = {
      basis: 'technical_judgment',
      user_response_id: null,
    },
  ): Decision {
    validate('Decision', decision);
    return this.mutate(
      actor,
      key,
      'decision.recorded',
      { decision, provenance },
      expectedVersion,
      () => {
        this.openRun(actor, ['user', 'chief']);
        if (decision.run_id !== actor.run_id)
          throw new CrewError('WRONG_RUN', 'Decision belongs to another run');
        let approvedBy = actor.id;
        if (provenance.basis === 'user_response') {
          if (!provenance.user_response_id)
            throw new CrewError(
              'INVALID_PROVENANCE',
              'User response is required',
            );
          const response = this.getRecord<UserResponse>(
            actor.run_id,
            'user_response',
            provenance.user_response_id,
          );
          const question = this.getRecord<CoordinationQuestion>(
            actor.run_id,
            'question',
            response.question_id,
          );
          if (
            question.status !== 'answered' ||
            question.response_id !== response.id ||
            decision.answer !== response.answer ||
            decision.affects_task_ids.some(
              (id) => !question.affects_task_ids.includes(id),
            ) ||
            !decision.source_ids.includes(response.source_id)
          )
            throw new CrewError(
              'INVALID_PROVENANCE',
              'Decision must retain the actual user response and its affected scope',
            );
          approvedBy = response.user_actor_id;
        } else if (
          provenance.basis !== 'technical_judgment' ||
          provenance.user_response_id !== null
        ) {
          throw new CrewError('INVALID_PROVENANCE', 'Invalid decision basis');
        }
        if (
          decision.status === 'approved' &&
          decision.approved_by !== approvedBy
        )
          throw new CrewError(
            'FORBIDDEN',
            'Approval must identify its authenticated author',
          );
        for (const id of decision.affects_task_ids)
          if (this.getTask(id).run_id !== actor.run_id)
            throw new CrewError('WRONG_RUN', 'Decision affects another run');
        if (decision.supersedes) {
          const previous = this.getRecord<Decision>(
            actor.run_id,
            'decision',
            decision.supersedes,
          );
          if (decision.status !== 'approved' || previous.status !== 'approved')
            throw new CrewError(
              'INVALID_DECISION',
              'Only an approved decision can supersede an approved decision',
            );
          previous.status = 'superseded';
          this.db
            .prepare(
              'UPDATE records SET data=? WHERE run_id=? AND kind=? AND id=?',
            )
            .run(
              JSON.stringify(previous),
              actor.run_id,
              'decision',
              previous.id,
            );
        }
        const stored = { ...decision, provenance };
        this.writeRecord(actor, 'decision', stored);
        return decision;
      },
    );
  }

  registerChiefSession(
    actor: Actor,
    session: AgentSession,
    key: string,
    expectedVersion: number,
  ): AgentSession {
    return this.mutate(
      actor,
      key,
      'chief.session_registered',
      session,
      expectedVersion,
      () => {
        const run = this.openRun(actor, ['user']);
        validate('Identifier', session.id);
        validate('ProviderId', session.provider);
        if (
          session.run_id !== run.id ||
          session.task_id !== null ||
          session.provider !== run.chief_provider ||
          session.model !== run.chief_model
        )
          throw new CrewError(
            'INVALID_SESSION',
            'Chief session must match this run without a task or attempt',
          );
        if (session.capabilities)
          validate('ProviderCapabilities', session.capabilities);
        this.writeRecord(actor, 'session', session);
        return session;
      },
    );
  }

  delegateTask(
    actor: Actor,
    args: DelegateTaskArgs,
    key: string,
    expectedVersion: number,
  ): Delegation {
    validate('DelegateTaskArgs', args);
    return this.mutate(
      actor,
      key,
      'task.delegated',
      args,
      expectedVersion,
      () => {
        this.openRun(actor, ['user', 'chief']);
        const task = this.getTask(args.task_id);
        if (task.run_id !== actor.run_id)
          throw new CrewError('WRONG_RUN', 'Delegation belongs to another run');
        const reassignable =
          ['changes_requested', 'blocked', 'waiting_provider'].includes(
            task.status,
          ) &&
          task.active_attempt_id &&
          ['exited', 'interrupted'].includes(
            this.getAttempt(task.active_attempt_id).status,
          );
        if (
          (!['ready', 'waiting_dependency'].includes(task.status) ||
            task.active_attempt_id) &&
          !reassignable
        )
          throw new CrewError(
            'TASK_NOT_READY',
            'Only an unclaimed task can be delegated',
          );
        const previous = this.allRecords<Delegation>(
          actor.run_id,
          'delegation',
        ).find((item) => item.task_id === task.id && item.status === 'queued');
        if (previous) {
          if (
            previous.provider !== args.provider ||
            previous.model !== args.model
          )
            throw new CrewError(
              'DELEGATION_MISMATCH',
              'Task already has another queued delegation',
            );
          return previous;
        }
        const delegation: Delegation = {
          ...args,
          id: ident('delegation'),
          run_id: actor.run_id,
          status: 'queued',
          attempt_id: null,
          created_at: now(),
        };
        this.writeRecord(actor, 'delegation', delegation, task.id);
        return delegation;
      },
    );
  }

  publishNote(
    actor: Actor,
    args: PublishNoteArgs,
    key: string,
    expectedVersion: number,
  ): TaskNote {
    validate('PublishNoteArgs', args);
    return this.mutate(
      actor,
      key,
      'task.note_published',
      args,
      expectedVersion,
      () => {
        this.assignedWorker(actor, args.task_id);
        this.scopedSources(actor, args.source_ids);
        const note: TaskNote = {
          ...args,
          content: redactSecrets(args.content),
          id: ident('note'),
          run_id: actor.run_id,
          actor_id: actor.id,
          created_at: now(),
        };
        this.writeRecord(actor, 'note', note, args.task_id);
        return note;
      },
    );
  }

  submitReview(
    actor: Actor,
    review: Review,
    key: string,
    expectedVersion: number,
  ): Review {
    validate('Review', review);
    return this.mutate(
      actor,
      key,
      'review.submitted',
      review,
      expectedVersion,
      () => {
        this.openRun(actor, ['reviewer']);
        const { task: control, attempt: reviewerAttempt } = this.assignedWorker(
          actor,
          review.review_task_id,
        );
        const target = this.getTask(review.review_of_task_id);
        const handoff = this.getRecord<Handoff>(
          actor.run_id,
          'handoff',
          review.handoff_id,
        );
        const producerAttempt = this.getAttempt(handoff.attempt_id);
        const producer = this.db
          .prepare(
            'SELECT actor_id FROM records WHERE run_id=? AND kind=? AND id=?',
          )
          .get(actor.run_id, 'handoff', handoff.id);
        if (
          review.run_id !== actor.run_id ||
          target.run_id !== actor.run_id ||
          handoff.task_id !== target.id ||
          review.source_revision !== handoff.source_revision ||
          this.currentHandoff(actor.run_id, target.id).id !== handoff.id ||
          target.active_attempt_id !== producerAttempt.id ||
          target.generation !== handoff.generation ||
          !['in_review', 'validating'].includes(target.status)
        )
          throw new CrewError(
            'STALE_REVIEW',
            'Review must refer to the current handoff and source',
          );
        const producerSession = this.getRecord<AgentSession>(
          actor.run_id,
          'session',
          producerAttempt.session_id,
        );
        const reviewerSession = this.getRecord<AgentSession>(
          actor.run_id,
          'session',
          reviewerAttempt.session_id,
        );
        if (
          control.id === target.id ||
          producer?.['actor_id'] === actor.id ||
          producerAttempt.id === reviewerAttempt.id ||
          producerSession.id === reviewerSession.id ||
          (producerSession.provider === reviewerSession.provider &&
            producerSession.native_session_id !== null &&
            producerSession.native_session_id ===
              reviewerSession.native_session_id)
        )
          throw new CrewError(
            'SELF_REVIEW',
            'Review must use an independent worker and provider conversation',
          );
        if (
          review.verification_scope === 'documentation' &&
          (!review.source_revision.startsWith('sha256:') ||
            review.tested_revision !== review.source_revision)
        )
          throw new CrewError(
            'INVALID_REVIEW',
            'Documentation review must inspect the exact document hash',
          );
        if (
          review.verification_scope === 'source' &&
          review.tested_revision !== null &&
          review.tested_revision !== review.source_revision
        )
          throw new CrewError(
            'INVALID_REVIEW',
            'Source review cannot claim another tested revision',
          );
        if (review.outcome === 'approved') {
          if (
            !review.tested_revision ||
            review.findings.some(
              (finding) => finding.severity === 'blocking',
            ) ||
            !review.verification_ids.length
          )
            throw new CrewError(
              'INVALID_REVIEW',
              'Approval requires tested evidence and no unresolved findings',
            );
          for (const id of review.verification_ids)
            this.checkedProof(actor.run_id, id, review.tested_revision);
          if (review.verification_scope === 'combined_code')
            this.preparedIntegration(
              actor.run_id,
              handoff,
              review.tested_revision,
              false,
            );
        }
        this.writeRecord(actor, 'review', review, target.id);
        if (review.outcome !== 'approved')
          this.moveTask(
            target,
            review.outcome === 'blocked' ? 'blocked' : 'changes_requested',
          );
        // The review is the control task's result; it has no recursive review task.
        this.moveTask(control, 'in_review');
        this.moveTask(control, 'validating');
        this.moveTask(control, 'accepted');
        return review;
      },
    );
  }

  validateDelivery(actor: Actor, args: AcceptDeliveryArgs): void {
    this.transaction(() => {
      this.deliveryCheck(actor, args, false);
    });
  }

  acceptDelivery(
    actor: Actor,
    args: AcceptDeliveryArgs,
    key: string,
    expectedVersion: number,
  ): TaskState {
    return this.mutate(
      actor,
      key,
      'task.accepted',
      args,
      expectedVersion,
      () => {
        const checked = this.deliveryCheck(actor, args, true);
        const { task, handoff } = checked;
        if (!checked.existing) {
          this.moveTask(task, 'validating');
          this.moveTask(task, 'accepted');
          task.accepted_revision = args.accepted_revision;
          this.writeTask(task);
          const acceptance: DeliveryAcceptance = {
            id: ident('acceptance'),
            run_id: actor.run_id,
            task_id: task.id,
            handoff_id: handoff.id,
            accepted_revision: args.accepted_revision,
            review_ids: [...new Set(args.review_ids)],
            verification_ids: [...new Set(args.verification_ids)],
            artifact_ids: checked.artifactIds,
            accepted_by: actor.id,
            created_at: now(),
          };
          this.writeRecord(actor, 'acceptance', acceptance, task.id);
          for (const dependent of this.tasks(actor.run_id))
            if (
              dependent.status === 'waiting_dependency' &&
              dependent.spec.depends_on.every(
                (id) => this.getTask(id).status === 'accepted',
              )
            )
              this.moveTask(dependent, 'ready');
        }
        return task;
      },
    );
  }

  finishRun(
    actor: Actor,
    args: FinishRunArgs,
    key: string,
    expectedVersion: number,
  ): Run {
    validate('FinishRunArgs', args);
    return this.mutate(
      actor,
      key,
      'run.completed',
      args,
      expectedVersion,
      (run) => {
        this.openRun(actor, ['user', 'chief']);
        const tasks = this.tasks(run.id);
        if (
          this.blockingQuestions(run.id).length ||
          this.attempts(run.id).some((attempt) =>
            ['queued', 'running', 'unknown'].includes(attempt.status),
          )
        )
          throw new CrewError(
            'RUN_BUSY',
            'Blocking questions or active attempts remain',
          );
        const acceptances = this.allRecords<DeliveryAcceptance>(
          run.id,
          'acceptance',
        );
        const proofs = acceptances.flatMap((acceptance) =>
          acceptance.verification_ids.map((id) =>
            this.checkedProof(run.id, id, acceptance.accepted_revision),
          ),
        );
        const artifactIds = new Set(
          acceptances.flatMap((acceptance) => acceptance.artifact_ids),
        );
        for (const id of artifactIds) this.checkedArtifact(run.id, id);
        for (const id of args.delivered_artifact_ids) {
          if (!artifactIds.has(id))
            throw new CrewError(
              'INVALID_EVIDENCE',
              'Final artifact is not part of an accepted delivery',
            );
          this.checkedArtifact(run.id, id);
        }
        const required = run.acceptance_criteria.filter(
          (criterion) => criterion.required,
        );
        if (
          new Set(args.criterion_evidence.map((item) => item.criterion_id))
            .size !== args.criterion_evidence.length ||
          args.criterion_evidence.some(
            (item) =>
              !run.acceptance_criteria.some(
                (criterion) => criterion.id === item.criterion_id,
              ),
          )
        )
          throw new CrewError(
            'INVALID_EVIDENCE',
            'Final criterion evidence must identify unique run criteria',
          );
        for (const criterion of required) {
          const entry = args.criterion_evidence.find(
            (item) => item.criterion_id === criterion.id,
          );
          if (
            !entry?.evidence_artifact_ids.length ||
            entry.evidence_artifact_ids.some(
              (id) =>
                !artifactIds.has(id) ||
                !proofs.some(
                  (proof) =>
                    proof.criterion_ids.includes(criterion.id) &&
                    proof.evidence_artifact_ids.includes(id),
                ),
            )
          )
            throw new CrewError(
              'MISSING_EVIDENCE',
              'Required run criterion lacks evidence from an accepted delivery',
            );
          for (const id of entry.evidence_artifact_ids)
            this.checkedArtifact(run.id, id);
        }
        if (run.status !== 'validating') {
          assertRunTransition(run.status, 'validating');
          run.status = 'validating';
        }
        assertRunCompletable(run, tasks, proofs);
        const final = { ...args, id: ident('final'), created_at: now() };
        this.writeRecord(actor, 'final', final);
        run.status = 'completed';
        return run;
      },
    );
  }

  reportBlocker(
    actor: Actor,
    args: ReportBlockerArgs,
    key: string,
    expectedVersion: number,
  ): TaskBlocker {
    validate('ReportBlockerArgs', args);
    return this.mutate(
      actor,
      key,
      'task.blocked',
      args,
      expectedVersion,
      () => {
        const { task } = this.assignedWorker(actor, args.task_id);
        this.scopedSources(actor, args.source_ids);
        const blocker: TaskBlocker = {
          ...args,
          reason: redactSecrets(args.reason),
          required_action: redactSecrets(args.required_action),
          id: ident('blocker'),
          run_id: actor.run_id,
          actor_id: actor.id,
          created_at: now(),
        };
        this.moveTask(task, 'blocked');
        task.wait_reason = blocker.reason;
        this.writeTask(task);
        this.writeRecord(actor, 'blocker', blocker, task.id);
        return blocker;
      },
    );
  }

  requestQuestion(
    actor: Actor,
    args: RequestUserInputArgs,
    key: string,
    expectedVersion: number,
  ): CoordinationQuestion {
    validate('RequestUserInputArgs', args);
    return this.mutate(
      actor,
      key,
      'question.requested',
      args,
      expectedVersion,
      () => {
        this.openRun(actor, ['user', 'chief']);
        const tasks = args.affects_task_ids.map((id) => this.getTask(id));
        if (
          tasks.some(
            (task) =>
              task.run_id !== actor.run_id ||
              ['accepted', 'cancelled'].includes(task.status),
          )
        )
          throw new CrewError(
            'INVALID_QUESTION',
            'Question must affect current tasks in this run',
          );
        const question: CoordinationQuestion = {
          id: args.question_id,
          run_id: actor.run_id,
          question: redactSecrets(args.question),
          options: args.options.map((option) => ({
            label: redactSecrets(option.label),
            consequence: redactSecrets(option.consequence),
          })),
          affects_task_ids: [...new Set(args.affects_task_ids)],
          blocking: args.blocking,
          status: 'open',
          requested_by: actor.id,
          response_id: null,
          created_at: now(),
        };
        this.writeRecord(actor, 'question', question);
        if (args.blocking)
          for (const task of tasks) {
            if (task.status === 'running') this.moveTask(task, 'waiting_user');
            task.wait_reason = `question:${question.id}`;
            this.writeTask(task);
          }
        return question;
      },
    );
  }

  respondQuestion(
    actor: Actor,
    questionId: string,
    answer: string,
    key: string,
    expectedVersion: number,
  ): UserResponse {
    return this.mutate(
      actor,
      key,
      'question.answered',
      { questionId, answer },
      expectedVersion,
      () => {
        this.openRun(actor, ['user']);
        if (!answer.trim())
          throw new CrewError(
            'INVALID_RESPONSE',
            'User answer must not be empty',
          );
        const question = this.getRecord<CoordinationQuestion>(
          actor.run_id,
          'question',
          questionId,
        );
        if (question.status !== 'open')
          throw new CrewError(
            'QUESTION_CLOSED',
            'Question already has a response',
          );
        const safe = redactSecrets(answer),
          id = ident('response'),
          sourceId = ident('source'),
          timestamp = now();
        const response: UserResponse = {
          id,
          run_id: actor.run_id,
          question_id: question.id,
          answer: safe,
          user_actor_id: actor.id,
          source_id: sourceId,
          created_at: timestamp,
        };
        const source: SourceRef = {
          id: sourceId,
          kind: 'user_message',
          reference: `user_response:${id}`,
          observed_at: timestamp,
          revision: `sha256:${createHash('sha256').update(safe).digest('hex')}`,
          authority: 'user_requirement',
          summary: safe,
        };
        validate('SourceRef', source);
        this.writeRecord(actor, 'source', source);
        this.writeRecord(actor, 'user_response', response);
        question.status = 'answered';
        question.response_id = id;
        this.replaceRecord(actor.run_id, 'question', question);
        if (question.blocking)
          for (const taskId of question.affects_task_ids) {
            const task = this.getTask(taskId);
            if (!this.blockingQuestions(actor.run_id, task.id).length) {
              if (task.status === 'waiting_user')
                this.moveTask(
                  task,
                  task.active_attempt_id ? 'running' : 'ready',
                );
              if (task.wait_reason?.startsWith('question:')) {
                task.wait_reason = null;
                this.writeTask(task);
              }
            }
          }
        return response;
      },
    );
  }

  observation(
    actor: Actor,
    type: string,
    payload: Record<string, unknown>,
    correlation: Partial<
      Pick<CrewEvent, 'task_id' | 'attempt_id' | 'session_id' | 'generation'>
    > = {},
  ): CrewEvent {
    return this.transaction(() => {
      this.authority(actor, ['user']);
      if (
        !/^(provider|turn|scheduler|context|tool|recovery)\.[a-z][a-z0-9_.]*$/.test(
          type,
        )
      )
        throw new CrewError(
          'INVALID_OBSERVATION',
          'Only runtime observation namespaces are permitted',
        );
      if (
        correlation.task_id &&
        this.getTask(correlation.task_id).run_id !== actor.run_id
      )
        throw new CrewError(
          'WRONG_RUN',
          'Observation task belongs to another run',
        );
      if (correlation.attempt_id) {
        const attempt = this.getAttempt(correlation.attempt_id);
        if (
          attempt.run_id !== actor.run_id ||
          (correlation.task_id && attempt.task_id !== correlation.task_id)
        )
          throw new CrewError(
            'WRONG_RUN',
            'Observation attempt belongs to another task or run',
          );
      }
      if (correlation.session_id)
        this.getRecord<AgentSession>(
          actor.run_id,
          'session',
          correlation.session_id,
        );
      return this.append(actor.run_id, actor, type, payload, correlation);
    });
  }

  setTaskWait(
    actor: Actor,
    taskId: string,
    status: 'waiting_provider' | 'waiting_user' | 'blocked' | 'failed',
    reason: string,
    key: string,
    expectedVersion: number,
  ): TaskState {
    return this.mutate(
      actor,
      key,
      'task.wait_changed',
      { taskId, status, reason },
      expectedVersion,
      () => {
        this.openRun(actor, ['user']);
        if (
          !['waiting_provider', 'waiting_user', 'blocked', 'failed'].includes(
            status,
          ) ||
          !reason.trim()
        )
          throw new CrewError(
            'INVALID_WAIT',
            'Task wait requires an explicit status and reason',
          );
        const task = this.getTask(taskId);
        if (task.run_id !== actor.run_id)
          throw new CrewError('WRONG_RUN', 'Task belongs to another run');
        this.moveTask(task, status);
        task.wait_reason = redactSecrets(reason);
        this.writeTask(task);
        return task;
      },
    );
  }

  replaceChief(
    actor: Actor,
    provider: ProviderId,
    model: string | null,
    key: string,
    expectedVersion: number,
  ): Run {
    validate('ProviderId', provider);
    return this.mutate(
      actor,
      key,
      'chief.replaced',
      { provider, model },
      expectedVersion,
      (run) => {
        this.openRun(actor, ['user']);
        if (model !== null && (typeof model !== 'string' || !model.trim()))
          throw new CrewError(
            'INVALID_MODEL',
            'Chief model must be null or a nonempty name',
          );
        run.generation++;
        run.chief_provider = provider;
        run.chief_model = model;
        return run;
      },
    );
  }

  sendMessage(
    actor: Actor,
    message: Message,
    key: string,
    expectedVersion: number,
  ): Message {
    return this.mutate(
      actor,
      key,
      'message.queued',
      message,
      expectedVersion,
      () => {
        this.authority(actor, [
          'user',
          'chief',
          'developer',
          'reviewer',
          'validator',
          'documenter',
          'investigator',
          'refactorer',
          'ci',
        ]);
        if (
          message.run_id !== actor.run_id ||
          message.sender_id !== actor.id ||
          message.status !== 'queued' ||
          !message.content.trim()
        )
          throw new CrewError(
            'INVALID_MESSAGE',
            'Invalid message author, content or initial status',
          );
        if (
          message.recipient_kind === 'task' &&
          this.getTask(message.recipient_id).run_id !== actor.run_id
        )
          throw new CrewError(
            'WRONG_RUN',
            'Message recipient belongs to another run',
          );
        const safe = { ...message, content: redactSecrets(message.content) };
        this.writeRecord(actor, 'message', safe);
        return safe;
      },
    );
  }

  updateMessage(
    actor: Actor,
    id: string,
    status: Message['status'],
    key: string,
    expectedVersion: number,
  ): Message {
    return this.mutate(
      actor,
      key,
      'message.updated',
      { id, status },
      expectedVersion,
      () => {
        this.authority(actor, ['user']);
        const message = this.getRecord<Message>(actor.run_id, 'message', id);
        const order = ['queued', 'delivered', 'acknowledged', 'applied'];
        if (
          message.status === 'failed' ||
          message.status === 'applied' ||
          (status !== 'failed' &&
            order.indexOf(status) !== order.indexOf(message.status) + 1)
        )
          throw new CrewError(
            'INVALID_TRANSITION',
            'Message state must advance one observation at a time',
          );
        message.status = status;
        this.db
          .prepare(
            'UPDATE records SET data=? WHERE run_id=? AND kind=? AND id=?',
          )
          .run(JSON.stringify(message), actor.run_id, 'message', id);
        return message;
      },
    );
  }

  updateSession(
    actor: Actor,
    id: string,
    changes: Pick<
      AgentSession,
      'native_session_id' | 'cli_version' | 'capabilities'
    > & { cwd?: string },
    key: string,
    expectedVersion: number,
  ): AgentSession {
    if (changes.capabilities)
      validate('ProviderCapabilities', changes.capabilities);
    return this.mutate(
      actor,
      key,
      'session.observed',
      { id, changes },
      expectedVersion,
      () => {
        this.authority(actor, ['user']);
        const session = this.getRecord<AgentSession>(
          actor.run_id,
          'session',
          id,
        );
        if (
          changes.cwd !== undefined &&
          (typeof changes.cwd !== 'string' ||
            !isAbsolute(changes.cwd) ||
            !existsSync(changes.cwd) ||
            !lstatSync(changes.cwd).isDirectory())
        )
          throw new CrewError(
            'INVALID_SESSION',
            'Observed cwd must be an existing absolute directory',
          );
        Object.assign(session, changes);
        this.db
          .prepare(
            'UPDATE records SET data=? WHERE run_id=? AND kind=? AND id=?',
          )
          .run(JSON.stringify(session), actor.run_id, 'session', id);
        return session;
      },
    );
  }

  saveContext(
    actor: Actor,
    context: ContextBundle,
    key: string,
    expectedVersion: number,
  ): ContextBundle {
    validate('ContextBundle', context);
    return this.mutate(
      actor,
      key,
      'context.saved',
      context,
      expectedVersion,
      () => {
        this.authority(actor, ['user', 'chief']);
        if (context.run_id !== actor.run_id)
          throw new CrewError('WRONG_RUN', 'Context belongs to another run');
        this.writeRecord(
          actor,
          'context',
          context,
          context.subject_kind === 'task' ? context.subject_id : null,
        );
        return context;
      },
    );
  }
  saveSource(
    actor: Actor,
    source: SourceRef,
    key: string,
    expectedVersion: number,
  ): SourceRef {
    validate('SourceRef', source);
    return this.mutate(
      actor,
      key,
      'source.saved',
      source,
      expectedVersion,
      () => {
        this.authority(actor, ['user', 'chief']);
        this.writeRecord(actor, 'source', source);
        return source;
      },
    );
  }
  saveWorkspace(
    actor: Actor,
    workspace: Workspace,
    key: string,
    expectedVersion: number,
  ): Workspace {
    return this.mutate(
      actor,
      key,
      'workspace.saved',
      workspace,
      expectedVersion,
      () => {
        this.authority(actor, ['user']);
        if (workspace.run_id !== actor.run_id)
          throw new CrewError('WRONG_RUN', 'Workspace belongs to another run');
        this.writeRecord(actor, 'workspace', workspace, workspace.task_id);
        return workspace;
      },
    );
  }
  saveVerification(
    actor: Actor,
    taskId: string,
    verification: Verification,
    key: string,
    expectedVersion: number,
    artifacts: ArtifactRef[] = [],
  ): Verification {
    validate('Verification', verification);
    return this.mutate(
      actor,
      key,
      'verification.observed',
      { taskId, verification, artifacts },
      expectedVersion,
      () => {
        this.authority(actor, ['user']);
        const task = this.getTask(taskId);
        if (task.run_id !== actor.run_id)
          throw new CrewError(
            'WRONG_RUN',
            'Verification task belongs to another run',
          );
        for (const artifact of artifacts) {
          validate('ArtifactRef', artifact);
          const producer = this.getAttempt(artifact.producer_attempt_id);
          if (
            producer.run_id !== actor.run_id ||
            producer.task_id !== taskId ||
            !verification.evidence_artifact_ids.includes(artifact.id)
          )
            throw new CrewError(
              'WRONG_PRODUCER',
              'Evidence artifact must belong to this task and verification',
            );
          if (!artifact.revision.startsWith('sha256:'))
            throw new CrewError(
              'INVALID_ARTIFACT',
              'Verification observations require an immutable snapshot',
            );
          this.readArtifact(artifact);
          const existing = this.db
            .prepare(
              'SELECT data FROM records WHERE run_id=? AND kind=? AND id=?',
            )
            .get(actor.run_id, 'artifact', artifact.id);
          if (existing) {
            if (
              canonical(this.decode<ArtifactRef>(existing, 'Artifact')) !==
              canonical(artifact)
            )
              throw new CrewError(
                'INVALID_ARTIFACT',
                'Existing evidence metadata differs',
              );
          } else this.writeRecord(actor, 'artifact', artifact, taskId);
        }
        for (const id of verification.evidence_artifact_ids)
          this.checkedArtifact(actor.run_id, id);
        this.writeRecord(actor, 'verification', verification, taskId);
        return verification;
      },
    );
  }
  beginOperation(
    actor: Actor,
    kind: string,
    target: string,
    key: string,
    expectedVersion: number,
  ): Operation {
    return this.mutate(
      actor,
      key,
      'operation.intended',
      { kind, target },
      expectedVersion,
      () => {
        this.authority(actor, ['user']);
        const operation: Operation = {
          id: ident('operation'),
          run_id: actor.run_id,
          idempotency_key: key,
          kind,
          target,
          status: 'intent',
          result: null,
          created_at: now(),
        };
        this.writeRecord(actor, 'operation', operation);
        return operation;
      },
    );
  }
  observeOperation(
    actor: Actor,
    id: string,
    status: Exclude<Operation['status'], 'intent'>,
    result: unknown,
    key: string,
    expectedVersion: number,
  ): Operation {
    return this.mutate(
      actor,
      key,
      'operation.observed',
      { id, status, result },
      expectedVersion,
      () => {
        this.authority(actor, ['user']);
        const operation = this.getRecord<Operation>(
          actor.run_id,
          'operation',
          id,
        );
        if (['completed', 'failed'].includes(operation.status))
          throw new CrewError(
            'TERMINAL_OPERATION',
            'Operation already finished',
          );
        operation.status = status;
        operation.result = result;
        this.db
          .prepare(
            'UPDATE records SET data=? WHERE run_id=? AND kind=? AND id=?',
          )
          .run(JSON.stringify(operation), actor.run_id, 'operation', id);
        return operation;
      },
    );
  }
  updateRunStatus(
    actor: Actor,
    status: Run['status'],
    key: string,
    expectedVersion: number,
  ): Run {
    return this.mutate(
      actor,
      key,
      'run.updated',
      { status },
      expectedVersion,
      (run) => {
        this.authority(actor, ['user', 'chief']);
        if (status === 'completed')
          throw new CrewError(
            'EVIDENCE_REQUIRED',
            'Run completion requires validated deliveries',
          );
        assertRunTransition(run.status, status);
        run.status = status;
        return { ...run, version: run.version + 1 };
      },
    );
  }

  overdueAttempts(runId: string, before: string): Attempt[] {
    return this.attempts(runId).filter(
      (attempt) =>
        ['queued', 'running', 'unknown'].includes(attempt.status) &&
        attempt.heartbeat_at < before,
    );
  }
  uncertainOperations(runId: string): Operation[] {
    return this.records<Operation>(runId, 'operation').filter(
      (operation) => !['completed', 'failed'].includes(operation.status),
    );
  }

  writeArtifact(
    content: string | Buffer,
    redact = false,
  ): { reference: string; revision: string } {
    const data = redact
      ? Buffer.from(redactSecrets(content.toString()))
      : Buffer.from(content);
    const digest = createHash('sha256').update(data).digest('hex');
    const directory = join(this.project.data_dir, 'artifacts');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink())
      throw new CrewError(
        'INVALID_ARTIFACT',
        'Artifact directory cannot be a symbolic link',
      );
    const filename = join(directory, digest);
    if (existsSync(filename) && lstatSync(filename).isSymbolicLink())
      throw new CrewError(
        'INVALID_ARTIFACT',
        'Artifact cannot be a symbolic link',
      );
    if (!existsSync(filename)) {
      const temporary = join(directory, `.${randomUUID()}.tmp`),
        fd = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(fd, data);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, filename);
    } else {
      this.readArtifact({
        reference: `artifacts/${digest}`,
        revision: `sha256:${digest}`,
      });
    }
    return { reference: `artifacts/${digest}`, revision: `sha256:${digest}` };
  }
  readArtifact(artifact: Pick<ArtifactRef, 'reference' | 'revision'>): Buffer {
    if (!/^artifacts\/[a-f0-9]{64}$/.test(artifact.reference))
      throw new CrewError(
        'INVALID_ARTIFACT',
        'Artifact reference is outside private storage',
      );
    const file = join(this.project.data_dir, artifact.reference),
      rel = relative(realpathSync(this.project.data_dir), realpathSync(file));
    if (lstatSync(file).isSymbolicLink())
      throw new CrewError(
        'INVALID_ARTIFACT',
        'Artifact cannot be a symbolic link',
      );
    if (isAbsolute(rel) || rel.startsWith('..'))
      throw new CrewError('INVALID_ARTIFACT', 'Artifact path escapes storage');
    const data = readFileSync(file);
    if (
      `sha256:${createHash('sha256').update(data).digest('hex')}` !==
      artifact.revision
    )
      throw new CrewError('ARTIFACT_CHANGED', 'Artifact digest does not match');
    return data;
  }
  async backup(destination: string): Promise<void> {
    if (existsSync(destination))
      throw new CrewError(
        'ALREADY_EXISTS',
        'Backup destination already exists',
      );
    await backup(this.db, destination);
    chmodSync(destination, 0o600);
    const source = join(this.project.data_dir, 'artifacts');
    if (existsSync(source)) {
      const target = join(dirname(destination), 'artifacts');
      mkdirSync(target, { recursive: true, mode: 0o700 });
      if (lstatSync(target).isSymbolicLink())
        throw new CrewError(
          'INVALID_ARTIFACT',
          'Backup artifact directory cannot be a symlink',
        );
      for (const digest of readdirSync(source).filter((name) =>
        /^[a-f0-9]{64}$/.test(name),
      )) {
        const data = this.readArtifact({
          reference: `artifacts/${digest}`,
          revision: `sha256:${digest}`,
        });
        const file = join(target, digest);
        if (!existsSync(file))
          copyFileSync(join(source, digest), file, constants.COPYFILE_EXCL);
        else if (
          lstatSync(file).isSymbolicLink() ||
          !readFileSync(file).equals(data)
        )
          throw new CrewError(
            'ARTIFACT_CHANGED',
            'Backup artifact conflicts with existing content',
          );
        chmodSync(file, 0o600);
      }
    }
  }

  exportMarkdown(runId: string): string {
    const run = this.getRun(runId);
    return redactSecrets(
      `# ${run.objective}\n\nRun: ${run.id}; version: ${run.version}; status: ${run.status}\n\n` +
        this.tasks(runId)
          .map((task) => `- ${task.id}: ${task.spec.title} (${task.status})`)
          .join('\n') +
        '\n\n' +
        this.records<Decision>(runId, 'decision')
          .map(
            (decision) =>
              `- ${decision.id} [${decision.status}]: ${decision.question} → ${decision.answer}; author: ${decision.approved_by ?? 'proposed'}; sources: ${decision.source_ids.join(', ')}`,
          )
          .join('\n') +
        '\n',
    );
  }
}
