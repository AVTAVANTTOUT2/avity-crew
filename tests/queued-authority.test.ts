import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CrewError, now } from '../packages/contracts/src/index.ts';
import type {
  Actor,
  Run,
  TaskSpec,
  ToolCall,
} from '../packages/contracts/src/index.ts';
import { identifyProject, Store } from '../packages/storage/src/index.ts';
import { CapabilityRegistry } from '../packages/supervisor/src/capabilities.ts';
import { SupervisorClient } from '../packages/supervisor/src/client.ts';
import { Coordinator } from '../packages/supervisor/src/coordinator.ts';
import type { TransportHandle } from '../packages/supervisor/src/protocol.ts';
import { startTransport } from '../packages/supervisor/src/transport.ts';

type Outcome = { ok: true; result: unknown } | { ok: false; error: unknown };

test(
  'a capability revoked while an authenticated HTTP mutation is queued cannot mutate when the queue resumes',
  { timeout: 10_000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'avity queued authority '));
    const root = join(directory, 'project');
    mkdirSync(root);
    const store = new Store(
      identifyProject(root, join(directory, 'private-data')),
    );
    const registry = new CapabilityRegistry(store);
    const coordinator = new Coordinator(store, {
      wake: () => {},
      admin: async () => {
        throw new Error(
          'No runtime administration or model is used by this fixture',
        );
      },
    });

    let release!: () => void;
    const previousMutation = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Delay the existing mutation queue as if an earlier operation were pending.
    // Authentication, tools, dispatch and Store mutations remain production code.
    (coordinator as unknown as { tail: Promise<unknown> }).tail =
      previousMutation;
    let markQueued!: () => void;
    const queued = new Promise<void>((resolve) => {
      markQueued = resolve;
    });
    let transport: TransportHandle | undefined;
    let pending: Promise<Outcome> | undefined;
    t.after(async () => {
      release();
      await pending;
      await transport?.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    });

    const timestamp = now();
    const run: Run = {
      id: 'run:queued-authority',
      project_id: store.project.id,
      objective: 'Reject authority that expires while an HTTP request waits',
      constraints: ['This fixture never starts a model'],
      acceptance_criteria: [
        {
          id: 'AC:no-expired-mutation',
          description: 'No queued domain write survives capability revocation',
          required: true,
          verification: 'Real Registry, HTTP, coordinator queue and SQLite',
        },
      ],
      delivery_mode: 'documentation',
      status: 'planning',
      chief_provider: 'fake',
      chief_model: null,
      generation: 1,
      version: 0,
      max_active_agents: 1,
      created_at: timestamp,
      updated_at: timestamp,
    };
    store.createRun(run, 'test:create-run');
    const actor: Actor = {
      id: 'chief:queued-authority',
      project_id: store.project.id,
      run_id: run.id,
      role: 'chief',
      task_id: null,
      attempt_id: null,
      generation: run.generation,
    };
    const token = registry.issue(actor);
    transport = await startTransport({
      directory: store.project.data_dir,
      project_id: store.project.id,
      registry,
      api: {
        tools: (principal, runId) => coordinator.tools(principal, runId),
        execute: (principal, call) => {
          const result = coordinator.execute(principal, call);
          // This is reached only after HTTP authenticated the real capability,
          // and execute has chained this mutation behind previousMutation.
          markQueued();
          return result;
        },
        admin: (principal, request) => coordinator.admin(principal, request),
      },
    });
    const client = new SupervisorClient({
      endpointFile: transport.endpointFile,
      capability: token,
    });
    const task: TaskSpec = {
      schema_version: 1,
      id: 'task:must-not-exist',
      run_id: run.id,
      title: 'A revoked queued request must not create this task',
      objective: 'Keep the domain unchanged after revocation',
      role: 'documenter',
      acceptance_criteria: [run.acceptance_criteria[0]!],
      depends_on: [],
      scope: { read_paths: [], write_paths: [], excluded_paths: [] },
      base_revision: null,
      context_source_ids: [],
      expected_deliverables: ['No write from expired authority'],
      created_at: timestamp,
    };
    const beforeRun = store.getRun(run.id);
    const beforeEvents = store.events(run.id, 0, 100);
    const action: ToolCall = {
      schema_version: 1,
      request_id: 'request:queued-before-revoke',
      idempotency_key: 'action:queued-before-revoke',
      run_id: run.id,
      expected_version: beforeRun.version,
      method: 'create_task',
      arguments: { task },
    };
    pending = client.execute(action).then(
      (result): Outcome => ({ ok: true, result }),
      (error: unknown): Outcome => ({ ok: false, error }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        queued,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error('The authenticated request never reached the queue'),
              ),
            2_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    assert.deepEqual(store.tasks(run.id), []);
    assert.deepEqual(store.getRun(run.id), beforeRun);

    registry.revoke(token);
    assert.throws(() => registry.authenticate(token), { code: 'FORBIDDEN' });
    assert.equal(store.getRun(run.id).generation, actor.generation);
    release();
    const outcome = await pending;

    assert.deepEqual(
      store.tasks(run.id),
      [],
      'Revocation while queued must prevent task creation after queue release',
    );
    assert.deepEqual(store.getRun(run.id), beforeRun);
    assert.deepEqual(store.records(run.id, 'operation'), []);
    assert.deepEqual(store.events(run.id, 0, 100), beforeEvents);
    if (outcome.ok)
      assert.fail('Expired authority must produce an HTTP denial');
    assert.ok(outcome.error instanceof CrewError);
    assert.ok(
      ['FORBIDDEN', 'REVOKED_CAPABILITY', 'STALE_AUTHORITY'].includes(
        outcome.error.code,
      ),
    );
  },
);
