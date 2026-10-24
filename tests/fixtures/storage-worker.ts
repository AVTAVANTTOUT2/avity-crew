import { Store } from '../../packages/storage/src/index.ts';
import type {
  Project,
  Actor,
  AgentSession,
} from '../../packages/contracts/src/index.ts';
import { DatabaseSync } from 'node:sqlite';

const input = JSON.parse(process.argv[2]!) as {
  project: Project;
  actor: Actor;
  session: AgentSession;
  key: string;
  version: number;
  action: 'claim' | 'crash' | 'init';
};
const store = new Store(input.project);
process.stdout.write('READY\n');
await new Promise<void>((resolve) =>
  process.stdin.once('data', () => resolve()),
);
if (input.action === 'claim') {
  try {
    console.log(
      JSON.stringify({
        id: store.claimTask(
          input.actor,
          input.session.task_id!,
          input.session,
          input.key,
          input.version,
        ).id,
      }),
    );
  } catch (error) {
    console.log(JSON.stringify({ error: (error as Error).message }));
    process.exitCode = 1;
  }
  store.close();
} else if (input.action === 'init') {
  store.close();
} else {
  const db = new DatabaseSync(store.filename);
  db.exec(
    'BEGIN IMMEDIATE; CREATE TABLE interrupted_migration (id INTEGER); PRAGMA user_version=99;',
  );
  process.stdout.write('UNCOMMITTED\n');
  await new Promise<void>(() => {});
}
