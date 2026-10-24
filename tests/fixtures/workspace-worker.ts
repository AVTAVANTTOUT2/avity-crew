import { Store } from '../../packages/storage/src/index.ts';
import { WorkspaceManager } from '../../packages/workspace/src/index.ts';
import type { Project, Actor } from '../../packages/contracts/src/index.ts';

const input = JSON.parse(process.argv[2]!) as {
  project: Project;
  actor: Actor;
  request: Parameters<WorkspaceManager['prepareIntegration']>[0];
  key: string;
};
const store = new Store(input.project);
try {
  await new WorkspaceManager(store, input.actor).prepareIntegration(
    input.request,
    input.key,
  );
} finally {
  store.close();
}
