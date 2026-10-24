import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { CrewError, validate } from '../../contracts/src/index.ts';
import {
  Store,
  defaultConfig,
  identifyProject,
} from '../../storage/src/index.ts';
import { startTransport } from './transport.ts';
import { SupervisorRuntime } from './runtime.ts';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--project')
  throw new CrewError('INVALID_INPUT', 'Usage: service --project DIRECTORY');
const directory = resolve(args[1]!);
let config = defaultConfig();
const configFile = join(directory, '.avity-crew.json');
if (existsSync(configFile)) {
  const stat = lstatSync(configFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024)
    throw new CrewError('INVALID_CONFIG', 'Invalid project configuration file');
  const parsed: unknown = JSON.parse(readFileSync(configFile, 'utf8'));
  validate('ProjectConfig', parsed);
  config = parsed;
}
const store = new Store(identifyProject(directory, undefined, config));
let closing = false;
const runtime = new SupervisorRuntime(
  store,
  join(store.project.data_dir, 'endpoint.json'),
  undefined,
  close,
);
const transport = await startTransport({
  directory: store.project.data_dir,
  project_id: store.project.id,
  registry: runtime.registry,
  api: runtime.coordinator,
});
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await runtime.close();
    await transport.close();
    store.close();
  } catch (error) {
    console.error(
      error instanceof CrewError
        ? `${error.code}: ${error.message}`
        : 'Service shutdown requires reconciliation',
    );
    process.exitCode = 1;
  }
}
process.once('SIGTERM', () => {
  void close();
});
process.once('SIGINT', () => {
  void close();
});
