// Scripted provider decisions only; filesystem, SQLite, TCP and HTTP stay real.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SupervisorClient } from '../../../dist/packages/supervisor/src/client.js';

const client = new SupervisorClient({
  endpointFile: process.env.AVITY_CREW_ENDPOINT_FILE,
  capability: process.env.AVITY_CREW_CAPABILITY,
});
const runId = process.env.AVITY_CREW_RUN_ID;
let sequence = 0;
const envelope = (method, args, version) => ({
  schema_version: 1,
  request_id: `load:${process.pid}:${++sequence}`,
  idempotency_key: `load:${process.pid}:${sequence}`,
  run_id: runId,
  expected_version: version,
  method,
  arguments: args,
});
const status = () =>
  client.execute(
    envelope('get_status', { after_seq: 0, limit: 200, task_id: null }, 0),
  );
async function mutate(method, args) {
  const action = envelope(method, args, (await status()).run_version);
  for (let retry = 0; ; retry++) {
    try {
      return await client.execute(action);
    } catch (error) {
      if (error.code !== 'VERSION_CONFLICT' || retry >= 63) throw error;
      action.expected_version = (await status()).run_version;
    }
  }
}

let database, server;
const guard = setTimeout(() => process.exit(2), 30_000);
try {
  const initial = (await status()).result;
  let ready;
  if (process.env.LOAD_ROLE === 'chief') {
    for (let index = 0; index < 7; index++) {
      const path = `load/writer-${index}.txt`;
      await mutate('create_task', {
        task: {
          schema_version: 1,
          id: `task:load-${index}`,
          run_id: runId,
          title: `Simulated writer ${index}`,
          objective: `Write only ${path}; no business acceptance is claimed`,
          role: 'developer',
          acceptance_criteria: initial.run.acceptance_criteria,
          depends_on: [],
          scope: {
            read_paths: ['app.mjs'],
            write_paths: [path],
            excluded_paths: [],
          },
          base_revision: process.env.LOAD_BASE_REVISION,
          context_source_ids: [],
          expected_deliverables: [path],
          created_at: new Date().toISOString(),
        },
      });
    }
    // Returning all seven replies while this chief is alive proves non-blocking delegation.
    for (let index = 0; index < 7; index++)
      await mutate('delegate_task', {
        task_id: `task:load-${index}`,
        provider: 'fake',
        model: null,
      });
    ready = { type: 'ready', role: 'chief', task_id: null, delegated: 7 };
  } else {
    assert.equal(initial.tasks.length, 1);
    const task = initial.tasks[0].spec,
      file = task.scope.write_paths[0];
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `simulated load ${task.id}\n`);
    database = new DatabaseSync(process.env.AVITY_CREW_DATABASE_PATH);
    database.exec('CREATE TABLE load_writer(task_id TEXT PRIMARY KEY)');
    database.prepare('INSERT INTO load_writer VALUES (?)').run(task.id);
    writeFileSync(join(process.env.TMPDIR, 'owner.txt'), task.id);
    server = createServer((socket) => socket.end('simulated load\n'));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(process.env.PORT), '127.0.0.1', resolve);
    });
    await mutate('publish_note', {
      task_id: task.id,
      kind: 'progress',
      content: `${task.id}:file-written`,
      source_ids: [],
    });
    await mutate('send_message', {
      recipient_kind: 'chief',
      recipient_id: 'chief:current',
      kind: 'information',
      content: `${task.id}:file-written`,
      source_ids: [],
      requires_ack: false,
    });
    const view = (await status()).result;
    assert.deepEqual(
      view.tasks.map((item) => item.id),
      [task.id],
    );
    assert.equal(view.messages.length, 1);
    assert.equal(view.messages[0].content, `${task.id}:file-written`);
    ready = {
      type: 'ready',
      role: 'worker',
      task_id: task.id,
      cwd: process.cwd(),
      file,
      port: Number(process.env.PORT),
      database: process.env.AVITY_CREW_DATABASE_PATH,
      temporary: process.env.TMPDIR,
      message_id: view.messages[0].id,
    };
  }
  process.send(ready);
  await new Promise((resolve) =>
    process.once('message', (message) => {
      assert.equal(message.type, 'release');
      resolve();
    }),
  );
} catch (error) {
  process.send?.({ type: 'error', message: error.message });
  process.exitCode = 1;
} finally {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  database?.close();
  clearTimeout(guard);
  process.disconnect();
}
