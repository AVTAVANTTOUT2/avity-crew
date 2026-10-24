import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { CrewError } from '../../contracts/src/index.ts';
import { redactSecrets } from '../../storage/src/index.ts';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  truncated: boolean;
  error: string | null;
}

export function runCommand(
  cwd: string,
  command: readonly string[],
  timeoutMs = 60_000,
  maxBytes = 1_048_576,
): Promise<CommandResult> {
  if (!command.length || command.some((part) => typeof part !== 'string'))
    throw new CrewError(
      'INVALID_COMMAND',
      'A command must contain executable and argv',
    );
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new CrewError(
      'INVALID_TIMEOUT',
      'Command timeout must be a positive millisecond integer',
    );
  return new Promise((resolve) => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd,
      env: { ...process.env, LC_ALL: 'C' },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: Buffer[][] = [[], []];
    const sizes = [0, 0];
    let truncated = false;
    let error: string | null = null;
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(
          process.platform === 'win32' ? child.pid : -child.pid,
          signal,
        );
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== 'ESRCH')
          error = (failure as Error).message;
      }
    };
    let escalation: NodeJS.Timeout | undefined;
    let closed: CommandResult | undefined;
    const timer = setTimeout(() => {
      error = `Command exceeded ${timeoutMs} ms`;
      kill('SIGTERM');
      escalation = setTimeout(() => {
        kill('SIGKILL');
        escalation = undefined;
        if (closed) resolve(closed);
      }, 500);
    }, timeoutMs);
    for (const [index, stream] of [child.stdout, child.stderr].entries())
      stream.on('data', (chunk: Buffer) => {
        const remaining = Math.max(0, maxBytes - sizes[index]!);
        if (chunk.length > remaining) truncated = true;
        if (remaining) output[index]!.push(chunk.subarray(0, remaining));
        sizes[index]! += chunk.length;
      });
    child.on('error', (failure) => {
      error = failure.message;
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      closed = {
        stdout: Buffer.concat(output[0]!).toString('utf8'),
        stderr: Buffer.concat(output[1]!).toString('utf8'),
        exitCode,
        signal,
        truncated,
        error,
      };
      // A closed parent can leave descendants with closed stdio in its process group.
      if (!escalation) resolve(closed);
    });
  });
}

export async function git(
  cwd: string,
  args: readonly string[],
  allowFailure = false,
): Promise<CommandResult> {
  const result = await runCommand(cwd, ['git', ...args], 120_000, 8_388_608);
  if (
    result.error ||
    result.truncated ||
    (!allowFailure && result.exitCode !== 0)
  )
    throw new CrewError(
      'GIT_FAILED',
      'Git operation did not complete successfully',
      {
        args,
        ...result,
        stdout: redactSecrets(result.stdout),
        stderr: redactSecrets(result.stderr),
        error: result.error ? redactSecrets(result.error) : null,
      },
    );
  return result;
}

export const line = (value: string): string => value.replace(/\r?\n$/, '');

export interface RepositoryState {
  root: string;
  commonDir: string | null;
  head: string | null;
  branch: string | null;
  changes: { status: string; path: string; originalPath?: string }[];
}

export async function inspectRepository(
  directory: string,
): Promise<RepositoryState> {
  const root = realpathSync(directory);
  const probe = await git(root, ['rev-parse', '--show-toplevel'], true);
  if (probe.exitCode !== 0) {
    if (!probe.stderr.includes('not a git repository'))
      throw new CrewError(
        'GIT_FAILED',
        'Cannot inspect repository',
        redactSecrets(probe.stderr),
      );
    return { root, commonDir: null, head: null, branch: null, changes: [] };
  }
  const top = realpathSync(line(probe.stdout));
  const common = await git(top, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  const head = await git(top, ['rev-parse', '--verify', 'HEAD'], true);
  const branch = await git(top, ['symbolic-ref', '--quiet', 'HEAD'], true);
  const status = await git(top, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  const entries = status.stdout.split('\0').filter(Boolean);
  const changes: RepositoryState['changes'] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    const change: RepositoryState['changes'][number] = {
      status: entry.slice(0, 2),
      path: entry.slice(3),
    };
    if (/[RC]/.test(change.status)) change.originalPath = entries[++index]!;
    changes.push(change);
  }
  return {
    root: top,
    commonDir: realpathSync(line(common.stdout)),
    head: head.exitCode === 0 ? line(head.stdout) : null,
    branch: branch.exitCode === 0 ? line(branch.stdout) : null,
    changes,
  };
}
