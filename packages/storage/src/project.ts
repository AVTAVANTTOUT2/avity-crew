import { createHash } from 'node:crypto';
import { realpathSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { now, validate } from '../../contracts/src/index.ts';
import type { Project, ProjectConfig } from '../../contracts/src/index.ts';

export function defaultConfig(): ProjectConfig {
  return {
    schema_version: 1,
    orchestrator: { provider: 'codex', model: null },
    workers: [
      { provider: 'claude', model: null },
      { provider: 'codex', model: null },
    ],
    max_active_agents: 7,
    language: 'fr',
    context: {
      input_budget_tokens: 24000,
      exclude_paths: [
        '.env',
        '.env.*',
        '*.pem',
        '*.key',
        'node_modules',
        '.git',
      ],
    },
    verification_commands: [],
    delivery: { mode: 'local', target_ref: null },
    permissions: {
      profile: 'workspace',
      allow_production: false,
      allow_external_publication: false,
    },
  };
}

export function identifyProject(
  directory: string,
  dataHome = process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'),
  config = defaultConfig(),
): Project {
  validate('ProjectConfig', config);
  const root = realpathSync(directory);
  let common: string | null = null;
  try {
    common = realpathSync(
      execFileSync(
        'git',
        ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim(),
    );
  } catch {
    /* Documentary projects do not require Git. */
  }
  const id = `project:${createHash('sha256')
    .update(common ?? root)
    .digest('hex')
    .slice(0, 32)}`;
  const dataDir = resolve(dataHome, 'avity-crew', id.replace(':', '-'));
  mkdirSync(dirname(dataDir), { recursive: true, mode: 0o700 });
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return {
    id,
    root,
    git_common_dir: common,
    data_dir: dataDir,
    config,
    map_version: 0,
    created_at: now(),
  };
}
