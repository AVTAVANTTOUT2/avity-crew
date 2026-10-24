import assert from 'node:assert/strict';
import test from 'node:test';
import { TurnScheduler } from '../packages/supervisor/src/scheduler.ts';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test('one slot delegates without waiting and alternates chief, worker, chief', async () => {
  const trace: string[] = [];
  const errors: unknown[] = [];
  const scheduler = new TurnScheduler(7, (_job, error) => errors.push(error));
  const chief = barrier(),
    worker = barrier();
  scheduler.enqueue({
    id: 'chief:1',
    run_id: 'run:a',
    role: 'chief',
    run_limit: 1,
    async execute() {
      trace.push('chief:start');
      scheduler.enqueue({
        id: 'worker:1',
        run_id: 'run:a',
        role: 'worker',
        run_limit: 1,
        async execute() {
          trace.push('worker:start');
          await worker.promise;
          trace.push('worker:end');
          scheduler.enqueue({
            id: 'chief:2',
            run_id: 'run:a',
            role: 'chief',
            run_limit: 1,
            async execute() {
              trace.push('chief:resume');
            },
          });
        },
      });
      trace.push('delegate:returned');
      await chief.promise;
      trace.push('chief:end');
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(trace, ['chief:start', 'delegate:returned']);
  assert.equal(scheduler.snapshot().active.length, 1);
  chief.release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(trace, [
    'chief:start',
    'delegate:returned',
    'chief:end',
    'worker:start',
  ]);
  worker.release();
  await scheduler.idle();
  assert.deepEqual(trace.slice(-2), ['worker:end', 'chief:resume']);
  assert.deepEqual(errors, []);
});

test('global and per-run concurrency count chief turns, isolate errors and deduplicate pending work', async () => {
  const scheduler = new TurnScheduler(3, () => {});
  const gate = barrier();
  let starts = 0,
    peak = 0;
  for (let index = 0; index < 6; index++) {
    const job = {
      id: 'turn:' + index,
      run_id: index < 4 ? 'run:a' : 'run:b',
      role: index === 0 ? ('chief' as const) : ('worker' as const),
      run_limit: 2,
      async execute() {
        starts++;
        peak = Math.max(peak, scheduler.snapshot().active.length);
        await gate.promise;
        if (index === 1) throw new Error('observed failure');
      },
    };
    scheduler.enqueue(job);
    scheduler.enqueue(job);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts, 3);
  assert.equal(
    scheduler.snapshot().active.filter((job) => job.run_id === 'run:a').length,
    2,
  );
  gate.release();
  await scheduler.idle();
  assert.equal(starts, 6);
  assert.equal(peak, 3);
  await scheduler.close();
  assert.throws(
    () =>
      scheduler.enqueue({
        id: 'late',
        run_id: 'run:a',
        role: 'chief',
        run_limit: 1,
        execute: async () => {},
      }),
    { code: 'SCHEDULER_STOPPED' },
  );
});
