import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { CrewError } from '../../contracts/src/index.ts';

export interface ProcessIdentity {
  pid: number;
  started_at: string;
  command_sha256: string;
  group_id: number | null;
  observed_at: string;
}

const execute = promisify(execFile);
const INSPECTION_MS = 350;
const STOP_MS = 2750;
const TERM_MS = 750;
const failed = (message: string) =>
  new CrewError('RECONCILIATION_REQUIRED', message);
const validPid = (pid: unknown): pid is number =>
  Number.isSafeInteger(pid) && Number(pid) > 0 && Number(pid) <= 0x7fffffff;
const isDead = (state: string) => /^[ZX]/.test(state);

function supported(): void {
  if (process.platform === 'win32')
    throw failed('POSIX process reconciliation is unsupported on Windows');
}

async function ps(
  args: string[],
  deadline: number,
  missingAllowed = false,
): Promise<string> {
  const timeout = Math.min(
    INSPECTION_MS,
    Math.floor(deadline - performance.now()),
  );
  if (timeout < 1)
    throw failed('Native process inspection exceeded its time limit');
  try {
    const result = await execute('/bin/ps', args, {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' },
      timeout,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
    });
    if (result.stderr.trim())
      throw failed('Native process inspection is ambiguous');
    return result.stdout;
  } catch (failure) {
    const error = failure as {
      code?: unknown;
      stdout?: unknown;
      stderr?: unknown;
    };
    if (
      missingAllowed &&
      error.code === 1 &&
      error.stdout === '' &&
      error.stderr === ''
    )
      return '';
    // execFile errors contain command/argv and captured output: never propagate them.
    throw failed(
      'Cannot inspect native processes safely within 350 ms and 1 MiB',
    );
  }
}

async function snapshot(
  pid: number,
  deadline: number,
): Promise<ProcessIdentity | null> {
  const output = await ps(
    [
      '-ww',
      '-p',
      String(pid),
      '-o',
      'pid=',
      '-o',
      'pgid=',
      '-o',
      'stat=',
      '-o',
      'lstart=',
      '-o',
      'command=',
    ],
    deadline,
    true,
  );
  if (!output) return null;
  const row =
    /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([A-Za-z]{3} [A-Za-z]{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})[ \t]+([^\r\n]+)\n?$/.exec(
      output,
    );
  if (
    !row ||
    Number(row[1]) !== pid ||
    !(Number(row[2]) === 0 || validPid(Number(row[2])))
  )
    throw failed('Native process snapshot is ambiguous');
  if (isDead(row[3]!)) return null;
  const birth = Date.parse(`${row[4]} UTC`);
  if (!Number.isFinite(birth))
    throw failed('Native process birth time is unavailable');
  return {
    pid,
    started_at: new Date(birth).toISOString(),
    command_sha256: createHash('sha256').update(row[5]!).digest('hex'),
    group_id: Number(row[2]) || null,
    observed_at: new Date().toISOString(),
  };
}

export async function observeProcess(
  pid: number,
): Promise<ProcessIdentity | null> {
  supported();
  if (!validPid(pid))
    throw failed('Process inspection requires a positive PID');
  return snapshot(pid, performance.now() + INSPECTION_MS);
}

async function liveMembers(group: number, deadline: number): Promise<number[]> {
  const output = await ps(
    ['-A', '-o', 'pid=', '-o', 'pgid=', '-o', 'stat='],
    deadline,
  );
  if (!output.trim()) throw failed('Native process group inventory is empty');
  const members: number[] = [];
  const seen = new Set<number>();
  for (const line of output.trim().split('\n')) {
    const row = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
    const pid = Number(row?.[1]),
      pgid = Number(row?.[2]);
    if (
      !row ||
      !(pid === 0 || validPid(pid)) ||
      !(pgid === 0 || validPid(pgid)) ||
      seen.has(pid)
    )
      throw failed('Native process group inventory is ambiguous');
    seen.add(pid);
    if (pgid === group && !isDead(row[3]!)) members.push(pid);
  }
  return members;
}

function same(expected: ProcessIdentity, actual: ProcessIdentity): boolean {
  return (
    expected.pid === actual.pid &&
    expected.started_at === actual.started_at &&
    expected.command_sha256 === actual.command_sha256 &&
    expected.group_id === actual.group_id
  );
}

function signal(group: number, value: NodeJS.Signals): void {
  try {
    process.kill(-group, value);
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException).code !== 'ESRCH')
      throw failed('Cannot signal the verified native process group');
  }
}

export async function stopOwnedProcess(
  identity: ProcessIdentity,
): Promise<'stopped' | 'already_exited'> {
  supported();
  if (
    !identity ||
    !validPid(identity.pid) ||
    identity.pid <= 1 ||
    identity.pid === process.pid ||
    identity.group_id !== identity.pid ||
    typeof identity.command_sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(identity.command_sha256) ||
    typeof identity.started_at !== 'string' ||
    !Number.isFinite(Date.parse(identity.started_at)) ||
    typeof identity.observed_at !== 'string' ||
    !Number.isFinite(Date.parse(identity.observed_at))
  )
    throw failed(
      'A recorded identity for an owned detached process group is required',
    );
  const deadline = performance.now() + STOP_MS;
  const caller = await snapshot(process.pid, deadline);
  if (!caller || caller.group_id === identity.group_id)
    throw failed('Refusing to signal the reconciling caller process group');
  const current = await snapshot(identity.pid, deadline);
  if (!current) {
    if ((await liveMembers(identity.pid, deadline)).length)
      throw failed(
        'The leader has exited but its process group still has live members',
      );
    return 'already_exited';
  }
  if (!same(identity, current))
    throw failed('Native process identity changed; refusing to signal');
  const termAt = performance.now();
  signal(identity.pid, 'SIGTERM');
  let killed = false;
  while (true) {
    if (!(await liveMembers(identity.pid, deadline)).length) return 'stopped';
    if (!killed && performance.now() - termAt >= TERM_MS) {
      const leader = await snapshot(identity.pid, deadline);
      if (leader && !same(identity, leader))
        throw failed('Native process identity changed during shutdown');
      signal(identity.pid, 'SIGKILL');
      killed = true;
    }
    if (performance.now() >= deadline)
      throw failed(
        'Native process group still has live members after shutdown',
      );
    await delay(Math.min(50, Math.max(1, deadline - performance.now())));
  }
}
