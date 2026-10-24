import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CrewError } from '../packages/contracts/src/index.ts';
import type {
  AgentSession,
  Message,
  ProviderAdapter,
  ProviderEvent,
  ProviderProcess,
  ProviderRequest,
  ProviderResult,
  Run,
  TaskNote,
} from '../packages/contracts/src/index.ts';
import { FakeProvider } from '../packages/providers/src/fake.ts';
import { identifyProject, Store } from '../packages/storage/src/index.ts';
import { SupervisorClient } from '../packages/supervisor/src/client.ts';
import { observeProcess } from '../packages/supervisor/src/reconciliation.ts';
import { SupervisorRuntime } from '../packages/supervisor/src/runtime.ts';
import { startTransport } from '../packages/supervisor/src/transport.ts';

type Ready = {
  type: 'ready';
  role: 'chief' | 'worker';
  task_id: string | null;
  delegated?: number;
  cwd?: string;
  file?: string;
  port?: number;
  database?: string;
  temporary?: string;
  message_id?: string;
};
type Turn = {
  child: ChildProcess;
  request: ProviderRequest;
  started: number;
  ended: number | null;
  ready: Ready | null;
  closed: Promise<ProviderResult>;
  stop: () => Promise<void>;
};
const fixture = fileURLToPath(
  new URL('../../tests/fixtures/load/session.mjs', import.meta.url),
);

/** No model: real detached Node processes act as the only external provider boundary. */
class LoadProvider implements ProviderAdapter {
  readonly id = 'fake' as const;
  readonly turns: Turn[] = [];
  readonly failures: string[] = [];
  readonly schedulerSamples: number[] = [];
  sample: () => number = () => 0;
  constructor(private readonly base: string) {}
  async probe() {
    return {
      ...(await new FakeProvider().probe()),
      binary_path: process.execPath,
      version: 'simulated-load:1',
    };
  }
  resume(): ProviderProcess {
    throw new CrewError(
      'UNSUPPORTED',
      'This load fixture never resumes a model',
    );
  }
  start(request: ProviderRequest): ProviderProcess {
    const child = spawn(process.execPath, [fixture], {
      cwd: request.cwd,
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ...request.bridge!.env,
        LOAD_ROLE: request.role,
        LOAD_BASE_REVISION: this.base,
      },
    });
    let stderr = '';
    child.stderr!.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-2000);
    });
    const id = `simulated:load-${this.turns.length}`;
    let close!: (value: ProviderResult) => void;
    const closed = new Promise<ProviderResult>((resolve) => {
      close = resolve;
    });
    const turn: Turn = {
      child,
      request,
      started: performance.now(),
      ended: null,
      ready: null,
      closed,
      stop: async () => {
        if (turn.ended === null) {
          try {
            process.kill(-child.pid!, 'SIGTERM');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          }
          const escalation = setTimeout(() => {
            if (turn.ended === null) {
              try {
                process.kill(-child.pid!, 'SIGKILL');
              } catch {
                /* Already gone. */
              }
            }
          }, 500);
          try {
            await closed;
          } finally {
            clearTimeout(escalation);
          }
        }
      },
    };
    this.turns.push(turn);
    this.schedulerSamples.push(this.sample());
    child.on('message', (message) => {
      const value = message as Ready | { type: 'error'; message: string };
      if (value.type === 'ready') turn.ready = value;
      else if (value.type === 'error')
        this.failures.push(`${id} ${request.role}: ${value.message}`);
      this.schedulerSamples.push(this.sample());
    });
    child.once('error', (error) => this.failures.push(error.message));
    child.once('close', (code, signal) => {
      turn.ended = performance.now();
      this.schedulerSamples.push(this.sample());
      if (code && !signal)
        this.failures.push(
          `${id} ${request.role}: ${stderr || `Fixture exited ${code}`}`,
        );
      close({
        provider: 'fake',
        provenance: 'simulated',
        native_session_id: id,
        exit_code: code,
        signal,
        success: code === 0 && signal === null,
        text: 'Scripted load only; no business completion',
        error: null,
      });
    });
    return {
      pid: child.pid ?? null,
      result: closed,
      events: (async function* (): AsyncGenerator<ProviderEvent> {
        yield {
          type: 'session',
          native_session_id: id,
          provenance: 'simulated',
        };
        const result = await closed;
        yield {
          type: 'result',
          success: result.success,
          provenance: 'simulated',
        };
      })(),
      send: async () => {
        throw new CrewError('UNSUPPORTED', 'No mid-turn model input');
      },
      interrupt: turn.stop,
      stop: turn.stop,
    };
  }
}

test(
  'simulated load exercises seven real runtime slots including chief, authenticated HTTP, isolated workspaces and owned POSIX processes',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'crew load simulated ')),
      root = join(directory, 'app with spaces');
    mkdirSync(root);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    git('init', '--initial-branch=main');
    writeFileSync(
      join(root, 'app.mjs'),
      "export const app = 'load-fixture';\n",
    );
    git('add', 'app.mjs');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@localhost',
      'commit',
      '-m',
      'Load fixture baseline',
    );
    const base = git('rev-parse', 'HEAD');
    const project = identifyProject(root, join(directory, 'state'));
    project.config.max_active_agents = 7;
    const store = new Store(project),
      provider = new LoadProvider(`git:${base}`);
    const runtime = new SupervisorRuntime(
      store,
      join(project.data_dir, 'endpoint.json'),
      [provider],
    );
    provider.sample = () => runtime.scheduler.snapshot().active.length;
    const transport = await startTransport({
      directory: project.data_dir,
      project_id: project.id,
      registry: runtime.registry,
      api: runtime.coordinator,
    });
    const owner = new SupervisorClient({
      endpointFile: transport.endpointFile,
      capability: readFileSync(runtime.registry.ownerKeyPath, 'utf8'),
    });
    t.after(async () => {
      try {
        await runtime.close();
      } finally {
        await Promise.all(provider.turns.map((turn) => turn.stop()));
        await transport.close();
        store.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
    const until = async (condition: () => boolean, reason: string) => {
      const deadline = performance.now() + 15_000;
      while (!condition()) {
        assert.deepEqual(provider.failures, []);
        const failed = store
          .listRuns()
          .flatMap((run) => store.events(run.id, 0, 1000))
          .filter((event) => event.type === 'turn.launch_failed');
        assert.deepEqual(
          failed.map((event) => event.payload),
          [],
        );
        assert.ok(performance.now() < deadline, reason);
        await delay(10);
      }
    };
    const run = (await owner.admin({
      method: 'create_run',
      arguments: {
        objective:
          'Measure seven simulated slots; do not accept any business deliverable',
        criteria: [
          'Capacity and isolation observed, not a completed application',
        ],
        chief_provider: 'fake',
        max_active_agents: 7,
        delivery_mode: 'code',
      },
    })) as Run;
    assert.equal(run.max_active_agents, 7);
    assert.equal(store.project.config.max_active_agents, 7);
    await until(
      () => provider.turns.filter((turn) => turn.ready).length === 7,
      'Chief and six workers must reach their observed barriers',
    );
    const first = runtime.scheduler.snapshot();
    assert.equal(first.active.length, 7);
    assert.equal(first.active.filter((job) => job.role === 'chief').length, 1);
    assert.equal(first.queued.filter((job) => job.role === 'worker').length, 1);
    assert.equal(provider.turns.length, 7);
    assert.ok(provider.turns.every((turn) => turn.ended === null));
    assert.equal(
      provider.turns.find((turn) => turn.ready?.role === 'chief')?.ready
        ?.delegated,
      7,
    );
    assert.ok(
      !provider.turns.some((turn) => turn.ready?.task_id === 'task:load-6'),
    );

    const workers = () =>
      provider.turns.filter((turn) => turn.ready?.role === 'worker');
    const checkAlive = async () => {
      const active = provider.turns.filter((turn) => turn.ended === null);
      const identities = await Promise.all(
        active.map((turn) => observeProcess(turn.child.pid!)),
      );
      assert.equal(new Set(active.map((turn) => turn.child.pid)).size, 7);
      assert.ok(
        identities.every(
          (identity) => identity && identity.group_id === identity.pid,
        ),
      );
      const ports = active
        .filter((turn) => turn.ready?.role === 'worker')
        .map((turn) => turn.ready!.port!);
      assert.equal(
        new Set(ports).size,
        6,
        'simultaneously owned ports are distinct',
      );
      await Promise.all(
        ports.map(
          (port) =>
            new Promise<void>((resolve, reject) => {
              const socket = createConnection({ host: '127.0.0.1', port });
              let reply = '';
              socket.setEncoding('utf8');
              socket.on('data', (chunk: string) => {
                reply += chunk;
              });
              socket.setTimeout(2000, () =>
                socket.destroy(new Error('Fixture port did not respond')),
              );
              socket.once('end', () => {
                try {
                  assert.equal(reply, 'simulated load\n');
                  resolve();
                } catch (error) {
                  reject(error);
                }
              });
              socket.once('error', reject);
            }),
        ),
      );
    };
    await checkAlive();
    const chosen = workers()[0]!;
    const client = new SupervisorClient({
      endpointFile: chosen.request.bridge!.env.AVITY_CREW_ENDPOINT_FILE!,
      capability: chosen.request.bridge!.env.AVITY_CREW_CAPABILITY!,
    });
    const foreign = store
      .tasks(run.id)
      .find((task) => task.id !== chosen.ready!.task_id)!;
    await assert.rejects(
      client.execute({
        schema_version: 1,
        request_id: 'load:foreign',
        idempotency_key: 'load:foreign',
        run_id: run.id,
        expected_version: store.getRun(run.id).version,
        method: 'publish_note',
        arguments: {
          task_id: foreign.id,
          kind: 'progress',
          content: 'Forbidden cross-task note',
          source_ids: [],
        },
      }),
      { code: 'FORBIDDEN' },
    );
    chosen.child.send({ type: 'release' });
    await until(
      () => workers().length === 7 && provider.turns.at(-1)?.ready !== null,
      'The queued writer must start after a real process exits',
    );
    const queued = provider.turns.find(
      (turn) => turn.ready?.task_id === 'task:load-6',
    )!;
    assert.ok(chosen.ended !== null && queued.started >= chosen.ended);
    assert.equal(provider.turns.length, 8);
    assert.equal(runtime.scheduler.snapshot().active.length, 7);
    await checkAlive();

    for (const field of ['cwd', 'database', 'temporary'] as const)
      assert.equal(
        new Set(workers().map((turn) => turn.ready![field])).size,
        7,
      );
    const sessions = store.records<AgentSession>(run.id, 'session'),
      notes = store.records<TaskNote>(run.id, 'note'),
      messages = store.records<Message>(run.id, 'message');
    assert.equal(notes.length, 7);
    assert.equal(messages.length, 7);
    for (const turn of workers()) {
      const ready = turn.ready!,
        session = sessions.find((item) => item.task_id === ready.task_id)!;
      assert.equal(
        notes.find((note) => note.task_id === ready.task_id)?.actor_id,
        session.id,
      );
      const message = messages.find((item) => item.id === ready.message_id)!;
      assert.equal(message.sender_id, session.id);
      assert.equal(message.recipient_kind, 'chief');
      assert.equal(
        readFileSync(join(ready.cwd!, ready.file!), 'utf8'),
        `simulated load ${ready.task_id}\n`,
      );
      assert.equal(
        readFileSync(join(ready.temporary!, 'owner.txt'), 'utf8'),
        ready.task_id,
      );
      const db = new DatabaseSync(ready.database!, { readOnly: true });
      try {
        assert.equal(
          db.prepare('SELECT task_id FROM load_writer').get()!['task_id'],
          ready.task_id,
        );
      } finally {
        db.close();
      }
    }
    assert.notEqual(store.getRun(run.id).status, 'completed');
    assert.equal(store.records(run.id, 'handoff').length, 0);
    assert.equal(store.records(run.id, 'acceptance').length, 0);
    const paused = (await owner.admin({
      method: 'pause',
      arguments: { run_id: run.id },
    })) as Run;
    assert.equal(paused.status, 'paused');
    await runtime.scheduler.idle();
    assert.equal(runtime.scheduler.snapshot().active.length, 0);
    assert.equal(runtime.scheduler.snapshot().queued.length, 0);
    assert.ok(
      (
        await Promise.all(
          provider.turns.map((turn) => observeProcess(turn.child.pid!)),
        )
      ).every((identity) => identity === null),
    );
    assert.ok(provider.turns.every((turn) => turn.ended !== null));
    const intervals = provider.turns
      .flatMap((turn) => [
        { at: turn.started, delta: 1 },
        { at: turn.ended!, delta: -1 },
      ])
      .sort((a, b) => a.at - b.at || a.delta - b.delta);
    let active = 0,
      peak = 0;
    for (const point of intervals) {
      active += point.delta;
      peak = Math.max(peak, active);
      assert.ok(active <= 7);
    }
    assert.equal(active, 0);
    assert.equal(peak, 7);
    assert.equal(Math.max(...provider.schedulerSamples), 7);
    assert.ok(provider.schedulerSamples.every((count) => count <= 7));
    if (provider.failures.length)
      t.diagnostic(
        JSON.stringify({
          turns: provider.turns.map((turn) => ({
            role: turn.request.role,
            task: turn.ready?.task_id,
            ended: turn.ended,
          })),
          events: store
            .events(run.id, 0, 1000)
            .slice(-15)
            .map((event) => ({ type: event.type, task: event.task_id })),
        }),
      );
    assert.deepEqual(provider.failures, []);
    assert.ok(
      store
        .events(run.id, 0, 1000)
        .filter((event) => event.type.startsWith('provider.'))
        .every(
          (event) =>
            'provenance' in event.payload &&
            event.payload.provenance === 'simulated',
        ),
    );
    assert.ok(store.tasks(run.id).every((task) => task.status !== 'accepted'));
    for (const turn of workers())
      assert.equal(
        readFileSync(join(turn.ready!.cwd!, turn.ready!.file!), 'utf8'),
        `simulated load ${turn.ready!.task_id}\n`,
      );
    assert.equal(git('rev-parse', 'HEAD'), base);
    assert.equal(git('status', '--porcelain'), '');
    t.diagnostic(
      JSON.stringify({
        level: 'simulated',
        provider: 'fake',
        platform: process.platform,
        node: process.version,
        configured_slots: 7,
        observed_process_peak: peak,
        scheduler_peak: 7,
        worker_workspaces: 7,
        live_llm_cli_count: 0,
        final_status: paused.status,
        business_completed: false,
      }),
    );
  },
);
