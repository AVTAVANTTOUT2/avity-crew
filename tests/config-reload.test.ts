import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { now, validate } from '../packages/contracts/src/index.ts';
import type { Project, Run } from '../packages/contracts/src/index.ts';
import {
  defaultConfig,
  identifyProject,
  Store,
} from '../packages/storage/src/index.ts';
import { SupervisorClient } from '../packages/supervisor/src/client.ts';

const cli = fileURLToPath(new URL('../../bin/avity-crew.mjs', import.meta.url));
const service = fileURLToPath(
  new URL('../packages/supervisor/src/main.js', import.meta.url),
);

for (const gitProject of [false, true]) {
  test(
    `service reloads full project configuration durably ${gitProject ? 'from a Git subdirectory' : 'without Git'}`,
    { timeout: 20_000 },
    async (t) => {
      const directory = mkdtempSync(join(tmpdir(), 'avity config reload '));
      const root = join(
        directory,
        gitProject ? 'Git project' : 'plain project',
      );
      const dataHome = join(directory, 'private-data');
      mkdirSync(root);
      const subdirectory = join(root, 'nested', 'directory');
      mkdirSync(subdirectory, { recursive: true });
      if (gitProject)
        execFileSync('git', ['init', '--quiet', root], { stdio: 'ignore' });
      const initial = defaultConfig();
      initial.max_active_agents = 3;
      initial.orchestrator.provider = 'claude';
      initial.workers = [{ provider: 'claude', model: null }];
      initial.context.input_budget_tokens = 18000;
      validate('ProjectConfig', initial);
      const configFile = join(root, '.avity-crew.json');
      writeFileSync(configFile, JSON.stringify(initial));

      // Seed durable user history through Store only. A planning/fake run cannot
      // launch a provider, and a nonzero map version detects metadata resets.
      const identified = identifyProject(root, dataHome, initial);
      const seededProject: Project = { ...identified, map_version: 17 };
      const seed = new Store(seededProject);
      const timestamp = now();
      const existingRun: Run = {
        id: 'run:existing-before-config-reload',
        project_id: seededProject.id,
        objective:
          'Preserve this existing offline run during configuration reload',
        constraints: ['Never start a model in this fixture'],
        acceptance_criteria: [
          {
            id: 'AC:preserve-run',
            description:
              'Configuration reload leaves the existing run unchanged',
            required: true,
            verification: 'Exact durable Store comparison',
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
      seed.createRun(existingRun, 'test:existing-run');
      const before = structuredClone(seed.project);
      const beforeRun = seed.getRun(existingRun.id);
      seed.close();

      const endpointFile = join(before.data_dir, 'endpoint.json');
      const ownerFile = join(before.data_dir, 'owner.key');
      const env = { ...process.env, XDG_DATA_HOME: dataHome, NO_COLOR: '1' };
      let foreground: ChildProcess | undefined;
      let foregroundExit: Promise<void> | undefined;
      let bootstrapError = '';
      const command = (args: string[], cwd = root): unknown => {
        const result = spawnSync(process.execPath, [cli, ...args], {
          cwd,
          env,
          encoding: 'utf8',
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        });
        assert.equal(
          result.error,
          undefined,
          'The CLI must finish within its bound',
        );
        assert.equal(result.status, 0, result.stderr);
        const response = JSON.parse(result.stdout) as {
          ok: boolean;
          data: unknown;
        };
        assert.equal(response.ok, true);
        return response.data;
      };
      const readEndpoint = (): { pid: number } =>
        JSON.parse(readFileSync(endpointFile, 'utf8')) as { pid: number };
      const alive = (pid: number): boolean => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
          throw error;
        }
      };
      const stopObserved = async (): Promise<void> => {
        if (existsSync(endpointFile)) {
          const endpoint = readEndpoint();
          if (alive(endpoint.pid)) {
            const client = new SupervisorClient({
              endpointFile,
              capability: readFileSync(ownerFile, 'utf8'),
            });
            await client.admin({ method: 'shutdown', arguments: {} });
            const deadline = Date.now() + 5_000;
            while (alive(endpoint.pid) && Date.now() < deadline)
              await delay(20);
            assert.equal(
              alive(endpoint.pid),
              false,
              'Observe the service exit before reopening Store',
            );
          }
        }
        if (
          foreground &&
          foreground.exitCode === null &&
          foreground.signalCode === null
        ) {
          foreground.kill('SIGTERM');
        }
        await foregroundExit;
      };
      t.after(async () => {
        await stopObserved();
        rmSync(directory, { recursive: true, force: true });
      });

      command(['init', '--json']);
      const first = command(['status', '--run', existingRun.id, '--json']) as {
        project: Project;
        run: Run;
      };
      assert.deepEqual(first.project.config, initial);
      assert.equal(first.project.map_version, 17);
      assert.deepEqual(first.run, beforeRun);
      await stopObserved();

      const reloaded = defaultConfig();
      reloaded.max_active_agents = 2;
      reloaded.language = 'fr';
      validate('ProjectConfig', reloaded);
      writeFileSync(configFile, JSON.stringify(reloaded));
      const restartDirectory = gitProject ? subdirectory : root;
      if (gitProject) {
        // CLI already canonicalizes its launch directory. Calling the real
        // service entry with a subdirectory additionally tests main's lookup.
        foreground = spawn(
          process.execPath,
          [service, '--project', subdirectory],
          {
            cwd: subdirectory,
            env,
            stdio: ['ignore', 'ignore', 'pipe'],
          },
        );
        foregroundExit = new Promise<void>((resolve, reject) => {
          foreground!.once('error', reject);
          foreground!.once('exit', () => resolve());
        });
        foreground.stderr?.on('data', (chunk: Buffer) => {
          bootstrapError = (bootstrapError + chunk.toString()).slice(-2048);
        });
        const deadline = Date.now() + 5_000;
        while (!existsSync(endpointFile) && Date.now() < deadline) {
          assert.equal(foreground.exitCode, null, bootstrapError);
          await delay(20);
        }
        assert.ok(
          existsSync(endpointFile),
          'The service must publish its endpoint',
        );
        assert.equal(readEndpoint().pid, foreground.pid);
      } else command(['service', 'start', '--json'], restartDirectory);

      const current = command(
        ['status', '--run', existingRun.id, '--json'],
        restartDirectory,
      ) as { project: Project; run: Run };
      if (gitProject)
        assert.equal(
          readEndpoint().pid,
          foreground!.pid,
          'The CLI must inspect the service started from the subdirectory',
        );
      assert.deepEqual(
        current.project.config,
        reloaded,
        'Restart must load the complete JSON from the canonical project root',
      );
      const { config: _oldConfig, ...stableBefore } = before;
      const { config: _newConfig, ...stableAfter } = current.project;
      assert.deepEqual(stableAfter, stableBefore);
      assert.deepEqual(current.run, beforeRun);
      await stopObserved();

      // Reopening with defaults must read the persisted replacement, not merely
      // the service's in-memory configuration or the caller's constructor input.
      const reopened = new Store(identifyProject(root, dataHome));
      try {
        assert.deepEqual(reopened.project.config, reloaded);
        const { config: _persistedConfig, ...stableReopened } =
          reopened.project;
        assert.deepEqual(stableReopened, stableBefore);
        assert.deepEqual(reopened.getRun(existingRun.id), beforeRun);
        assert.equal(reopened.listRuns().length, 1);
      } finally {
        reopened.close();
      }
    },
  );
}
