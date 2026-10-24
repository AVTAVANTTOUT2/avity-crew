import { CrewError } from '../../contracts/src/index.ts';
import type {
  TaskStatus,
  Handoff,
  Attempt,
  TaskState,
  RunStatus,
  Run,
  Verification,
} from '../../contracts/src/index.ts';

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  planned: ['ready', 'waiting_dependency', 'cancelled'],
  ready: ['running', 'waiting_dependency', 'cancelled'],
  running: [
    'in_review',
    'waiting_user',
    'waiting_provider',
    'blocked',
    'failed',
    'cancelled',
  ],
  waiting_dependency: ['ready', 'blocked', 'cancelled'],
  waiting_user: ['ready', 'running', 'blocked', 'cancelled'],
  waiting_provider: ['ready', 'running', 'blocked', 'failed', 'cancelled'],
  blocked: ['ready', 'running', 'failed', 'cancelled'],
  in_review: ['changes_requested', 'validating', 'blocked', 'cancelled'],
  changes_requested: ['ready', 'running', 'cancelled'],
  validating: [
    'accepted',
    'changes_requested',
    'blocked',
    'failed',
    'cancelled',
  ],
  accepted: [],
  failed: ['ready', 'cancelled'],
  cancelled: [],
};

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!transitions[from].includes(to))
    throw new CrewError('INVALID_TRANSITION', `${from} → ${to} is not allowed`);
}

export function assertCurrentAttempt(
  handoff: Handoff,
  attempt: Attempt,
  task: TaskState,
): void {
  if (
    handoff.attempt_id !== attempt.id ||
    handoff.task_id !== attempt.task_id ||
    handoff.run_id !== attempt.run_id ||
    handoff.generation !== attempt.generation ||
    task.active_attempt_id !== attempt.id ||
    task.generation !== attempt.generation ||
    task.id !== attempt.task_id ||
    task.run_id !== attempt.run_id
  ) {
    throw new CrewError(
      'STALE_ATTEMPT',
      'The delivery does not belong to the current attempt',
    );
  }
  assertTransition(task.status, 'in_review');
  if (attempt.status !== 'running' && attempt.status !== 'exited')
    throw new CrewError(
      'INACTIVE_ATTEMPT',
      'This attempt cannot submit a delivery',
    );
  if (
    handoff.artifacts.some(
      (artifact) => artifact.producer_attempt_id !== attempt.id,
    )
  )
    throw new CrewError(
      'WRONG_PRODUCER',
      'Artifact belongs to another attempt',
    );
}

const runTransitions: Record<RunStatus, readonly RunStatus[]> = {
  planning: ['running', 'waiting_user', 'blocked', 'cancelled'],
  running: [
    'paused',
    'waiting_user',
    'waiting_provider',
    'blocked',
    'validating',
    'failed',
    'cancelled',
  ],
  paused: ['running', 'cancelled'],
  waiting_user: ['running', 'paused', 'blocked', 'cancelled'],
  waiting_provider: ['running', 'paused', 'blocked', 'failed', 'cancelled'],
  blocked: ['running', 'paused', 'failed', 'cancelled'],
  validating: ['running', 'completed', 'blocked', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!runTransitions[from].includes(to))
    throw new CrewError('INVALID_TRANSITION', `${from} → ${to} is not allowed`);
}

export function assertRunCompletable(
  run: Run,
  tasks: readonly TaskState[],
  verifications: readonly Verification[],
): void {
  assertRunTransition(run.status, 'completed');
  if (
    !tasks.length ||
    tasks.some((task) => task.run_id !== run.id || task.status !== 'accepted')
  )
    throw new CrewError(
      'INCOMPLETE_TASKS',
      'All deliverable tasks must be accepted',
    );
  const missing = run.acceptance_criteria.filter(
    (criterion) =>
      criterion.required &&
      !verifications.some(
        (verification) =>
          verification.result === 'passed' &&
          verification.criterion_ids.includes(criterion.id),
      ),
  );
  if (missing.length)
    throw new CrewError(
      'MISSING_EVIDENCE',
      'Run criteria lack passing evidence',
      missing.map((c) => c.id),
    );
}

export function assertLiveVerification(verification: Verification): void {
  if (verification.mode !== 'live' || verification.provider === 'fake')
    throw new CrewError(
      'SIMULATED_EVIDENCE',
      'Simulation cannot satisfy a live verification',
    );
}

export function assertAcyclic(
  dependencies: ReadonlyMap<string, readonly string[]>,
): void {
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];
  function visit(id: string): void {
    if (active.has(id))
      throw new CrewError(
        'DEPENDENCY_CYCLE',
        `Dependency cycle: ${[...path, id].join(' → ')}`,
      );
    if (visited.has(id)) return;
    active.add(id);
    path.push(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (!dependencies.has(dependency))
        throw new CrewError(
          'MISSING_DEPENDENCY',
          `Unknown dependency: ${dependency}`,
        );
      visit(dependency);
    }
    path.pop();
    active.delete(id);
    visited.add(id);
  }
  for (const id of dependencies.keys()) visit(id);
}
