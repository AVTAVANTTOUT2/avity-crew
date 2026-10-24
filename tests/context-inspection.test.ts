import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { now } from '../packages/contracts/src/index.ts';
import type {
  Actor,
  ContextBundle,
  Run,
  TaskSpec,
} from '../packages/contracts/src/index.ts';
import {
  compileContext,
  inspectProject,
  selectTaskSources,
} from '../packages/context/src/index.ts';
import type { ContextInspection } from '../packages/context/src/index.ts';
import { FakeProvider } from '../packages/providers/src/fake.ts';
import { identifyProject, Store } from '../packages/storage/src/index.ts';
import { SupervisorClient } from '../packages/supervisor/src/client.ts';
import type { TransportHandle } from '../packages/supervisor/src/protocol.ts';
import { SupervisorRuntime } from '../packages/supervisor/src/runtime.ts';
import { startTransport } from '../packages/supervisor/src/transport.ts';

const digest = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

test('HTTP context inspection finds late compilation metadata and returns the exact saved prompt and inspection', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'avity context inspection '));
  const projectRoot = join(directory, 'project');
  mkdirSync(projectRoot);
  const project = identifyProject(projectRoot, join(directory, 'private-data'));
  const store = new Store(project);
  // No adapters or scheduler wake: this fixture never starts a model.
  const runtime = new SupervisorRuntime(
    store,
    join(project.data_dir, 'endpoint.json'),
    [],
  );
  let transport: TransportHandle | undefined;
  t.after(async () => {
    await runtime.close();
    await transport?.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const timestamp = now();
  const run: Run = {
    id: 'run:context-inspection',
    project_id: project.id,
    objective: 'Inspect the exact context after a long event history',
    constraints: ['Preserve Unicode, newlines and the saved source provenance'],
    acceptance_criteria: [
      {
        id: 'AC:exact-context',
        description:
          'The inspected prompt matches the prompt saved for the turn',
        required: true,
        verification: 'Authenticated HTTP and independent SHA-256 comparison',
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
  const user: Actor = {
    id: 'user:local',
    project_id: project.id,
    run_id: run.id,
    role: 'user',
    task_id: null,
    attempt_id: null,
    generation: 1,
  };
  writeFileSync(
    join(projectRoot, 'requirements.md'),
    '# Contexte observé\nPréserver les accents et les lignes.\n',
  );
  const selectionTask: TaskSpec = {
    schema_version: 1,
    id: 'task:context-selection',
    run_id: run.id,
    title: 'Select inspection fixture sources',
    objective: run.objective,
    role: 'investigator',
    acceptance_criteria: [run.acceptance_criteria[0]!],
    depends_on: [],
    scope: {
      read_paths: ['requirements.md'],
      write_paths: [],
      excluded_paths: [],
    },
    base_revision: null,
    context_source_ids: [],
    expected_deliverables: ['An exact inspectable context'],
    created_at: timestamp,
  };
  const compiled = compileContext({
    id: 'context:late-compiled-turn',
    version: 1,
    created_at: timestamp,
    actor: {
      ...user,
      id: 'chief:context-inspection',
      role: 'chief',
      attempt_id: 'turn:context-inspection',
    },
    orchestrator_id: 'chief:context-inspection',
    workspace_path: project.root,
    run,
    selection: await selectTaskSources(
      await inspectProject(projectRoot),
      selectionTask,
    ),
    provider: await new FakeProvider().probe(),
    execution_policy: { purpose: 'Offline context inspection regression' },
    available_tools: [],
    dependencies: [],
    decisions: [],
    messages: [],
    budget: { context_window_tokens: 24000, reserve_tokens: 4000 },
  });

  for (const source of compiled.bundle.sources)
    store.saveSource(
      user,
      source,
      `test:source:${source.id}`,
      store.getRun(run.id).version,
    );
  for (let index = 0; index < 250; index++)
    store.observation(user, 'provider.text', {
      type: 'text',
      provenance: 'simulated',
      text: `Trusted test observation ${index}`,
    });
  store.saveContext(
    user,
    compiled.bundle,
    'test:save-context',
    store.getRun(run.id).version,
  );
  const prompt = store.writeArtifact(compiled.prompt);
  const inspection = store.writeArtifact(JSON.stringify(compiled.inspection));
  const references = { context_id: compiled.bundle.id, prompt, inspection };
  const event = store.observation(user, 'context.compiled', references);
  assert.ok(event.seq > 200, 'The compilation must be outside the first page');

  transport = await startTransport({
    directory: project.data_dir,
    project_id: project.id,
    registry: runtime.registry,
    api: runtime.coordinator,
  });
  runtime.initialize();
  const client = new SupervisorClient({
    endpointFile: transport.endpointFile,
    capability: readFileSync(runtime.registry.ownerKeyPath, 'utf8'),
  });
  const response = (await client.admin({
    method: 'inspect_context',
    arguments: { run_id: run.id, subject_id: compiled.bundle.subject_id },
  })) as {
    context: ContextBundle;
    references: typeof references | null;
    prompt: string;
    inspection: ContextInspection;
  };

  assert.deepEqual(response.context, compiled.bundle);
  assert.ok(
    response.references,
    'Compilation references must remain inspectable beyond the first 200 events',
  );
  assert.deepEqual(response.references, references);
  assert.equal(
    response.prompt,
    compiled.prompt,
    'Return the exact saved prompt',
  );
  assert.deepEqual(response.inspection, compiled.inspection);
  assert.equal(digest(response.prompt), response.context.content_sha256);
  assert.equal(prompt.revision, `sha256:${digest(response.prompt)}`);
  assert.equal(
    inspection.revision,
    `sha256:${digest(JSON.stringify(response.inspection))}`,
  );
});
