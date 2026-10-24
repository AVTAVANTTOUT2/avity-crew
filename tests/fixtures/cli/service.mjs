// Test-only service process: no scheduler or provider, callbacks explicitly fake.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Store,
  identifyProject,
} from '../../../dist/packages/storage/src/index.js';
import { CapabilityRegistry } from '../../../dist/packages/supervisor/src/capabilities.js';
import { startTransport } from '../../../dist/packages/supervisor/src/transport.js';
const project = identifyProject(
  process.argv[process.argv.indexOf('--project') + 1],
);
const store = new Store(project);
writeFileSync(
  join(project.data_dir, 'launch-audit.json'),
  JSON.stringify({
    argv: process.argv.slice(2),
    capability_in_env: Boolean(process.env.AVITY_CREW_CAPABILITY),
  }),
  { mode: 0o600 },
);
let handle;
handle = await startTransport({
  directory: project.data_dir,
  project_id: project.id,
  registry: new CapabilityRegistry(store),
  api: {
    tools: () => [],
    execute: async () => ({ fake: true }),
    admin: async (_principal, request) => {
      if (request.method === 'shutdown') {
        setTimeout(async () => {
          await handle.close();
          store.close();
          process.exit(0);
        }, 20);
        return { requested: true, fake: true };
      }
      return {
        project,
        run: null,
        tasks: [],
        events: [],
        next_seq: 0,
        sessions: [],
        fake: true,
      };
    },
  },
});
