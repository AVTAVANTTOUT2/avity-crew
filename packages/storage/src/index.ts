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
} from '../../contracts/src/index.ts';
import {
  assertAcyclic,
  assertTransition,
  assertCurrentAttempt,
  assertRunTransition,
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
  | 'verification';
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
        if (!row)
          this.db
            .prepare('INSERT INTO project(id,data) VALUES (?,?)')
            .run(project.id, JSON.stringify(project));
        return row
          ? {
              ...(JSON.parse(String(row['data'])) as Project),
              data_dir: project.data_dir,
            }
          : project;
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
  private append(
    runId: string,
    actor: Actor,
    type: string,
    payload: Record<string, unknown>,
    correlation: Partial<
      Pick<CrewEvent, 'task_id' | 'attempt_id' | 'session_id' | 'generation'>
    > = {},
  ): void {
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
        }>;
      const attemptId =
        method === 'task.claimed' || method === 'attempt.observed'
          ? result.id
          : (target.attempt_id ?? actor.attempt_id);
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
            (method === 'session.observed'
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
        this.authority(actor, ['user', 'chief']);
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
        this.authority(actor, ['user', 'chief']);
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
        this.authority(actor, ['user', 'chief']);
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
        this.authority(actor, [
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
  ): Decision {
    validate('Decision', decision);
    return this.mutate(
      actor,
      key,
      'decision.recorded',
      decision,
      expectedVersion,
      () => {
        this.authority(actor, ['user', 'chief']);
        if (decision.run_id !== actor.run_id)
          throw new CrewError('WRONG_RUN', 'Decision belongs to another run');
        if (decision.status === 'approved' && decision.approved_by !== actor.id)
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
        this.writeRecord(actor, 'decision', decision);
        return decision;
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
    >,
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
  ): Verification {
    validate('Verification', verification);
    return this.mutate(
      actor,
      key,
      'verification.observed',
      { taskId, verification },
      expectedVersion,
      () => {
        this.authority(actor, ['user']);
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
