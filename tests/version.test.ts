import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('CLI version, JSON output and help match the distributed package', () => {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as {
    version: string;
  };
  const cli = resolve('bin/avity-crew.mjs');
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  assert.equal(run('--version').trim(), version);
  assert.equal(JSON.parse(run('--version', '--json')).data, version);
  assert.ok(run('--help').startsWith(`Avity Crew ${version} —`));
});
