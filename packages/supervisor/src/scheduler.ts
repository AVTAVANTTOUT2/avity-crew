import { CrewError } from '../../contracts/src/index.ts';

export interface TurnJob {
  id: string;
  run_id: string;
  role: 'chief' | 'worker';
  run_limit: number;
  execute(): Promise<void>;
}

/** A slot belongs to one active turn, including the chief, until its process settles. */
export class TurnScheduler {
  private readonly queued: TurnJob[] = [];
  private readonly running = new Map<string, TurnJob>();
  private readonly waiters = new Set<() => void>();
  private stopped = false;

  constructor(
    readonly limit: number,
    private readonly onError: (job: TurnJob, error: unknown) => void,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new CrewError(
        'INVALID_LIMIT',
        'Active turn limit must be a positive integer',
      );
  }

  enqueue(job: TurnJob): void {
    if (this.stopped)
      throw new CrewError('SCHEDULER_STOPPED', 'Scheduler is closing');
    if (!Number.isSafeInteger(job.run_limit) || job.run_limit < 1)
      throw new CrewError(
        'INVALID_LIMIT',
        'Run turn limit must be a positive integer',
      );
    if (
      this.running.has(job.id) ||
      this.queued.some((pending) => pending.id === job.id)
    )
      return;
    this.queued.push(job);
    this.pump();
  }

  snapshot(): {
    active: { id: string; run_id: string; role: TurnJob['role'] }[];
    queued: { id: string; run_id: string; role: TurnJob['role'] }[];
  } {
    const view = ({ id, run_id, role }: TurnJob) => ({ id, run_id, role });
    return {
      active: [...this.running.values()].map(view),
      queued: this.queued.map(view),
    };
  }

  cancelQueued(runId: string): void {
    for (let index = this.queued.length - 1; index >= 0; index--)
      if (this.queued[index]!.run_id === runId) this.queued.splice(index, 1);
    this.settle();
  }

  /** The owner interrupts active processes before awaiting close; queued work stays in SQLite. */
  async close(): Promise<void> {
    this.stopped = true;
    this.queued.length = 0;
    await this.idle();
  }

  idle(): Promise<void> {
    if (!this.running.size && !this.queued.length) return Promise.resolve();
    return new Promise((resolve) => this.waiters.add(resolve));
  }

  private pump(): void {
    while (!this.stopped && this.running.size < this.limit) {
      const index = this.queued.findIndex((job) => {
        const active = [...this.running.values()].filter(
          (turn) => turn.run_id === job.run_id,
        );
        return (
          active.length < job.run_limit &&
          (job.role !== 'chief' ||
            !active.some((turn) => turn.role === 'chief'))
        );
      });
      if (index < 0) break;
      const job = this.queued.splice(index, 1)[0]!;
      this.running.set(job.id, job);
      void Promise.resolve()
        .then(() => job.execute())
        .catch((error: unknown) => {
          try {
            this.onError(job, error);
          } catch {
            /* The slot must still be released. */
          }
        })
        .finally(() => {
          this.running.delete(job.id);
          this.pump();
          this.settle();
        });
    }
    this.settle();
  }

  private settle(): void {
    if (this.running.size || this.queued.length) return;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }
}
