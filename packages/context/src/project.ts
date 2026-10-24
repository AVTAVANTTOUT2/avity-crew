import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  matchesGlob,
  relative,
  resolve,
  sep,
} from 'node:path';
import { promisify } from 'node:util';
import { CrewError, now, validate } from '../../contracts/src/index.ts';
import type { SourceRef, TaskSpec } from '../../contracts/src/index.ts';

const execute = promisify(execFile);
const INSTRUCTIONS = new Set(['AGENTS.md', 'CLAUDE.md', 'agent.md']);
const MANIFESTS = new Set([
  'package.json',
  'composer.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Makefile',
]);
const OMIT_DIRECTORIES = new Set([
  '.git',
  '.avity-crew',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
]);
const PRIVATE_DIRECTORIES = new Set([
  '.codex',
  '.claude',
  '.ssh',
  '.aws',
  '.gnupg',
  '.azure',
  '.kube',
  '.docker',
]);

export const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

export interface ContextExclusion {
  reference: string;
  reason: string;
}
export interface SourceSnapshot {
  source: SourceRef;
  content: string;
  reason: string;
  redacted: boolean;
}
export interface ProjectMap {
  root: string;
  observed_at: string;
  git: { revision: string | null; status: string | null };
  files: string[];
  sources: SourceSnapshot[];
  commands: { command: string; source_id: string }[];
  modules: string[];
  exclusions: ContextExclusion[];
  warnings: string[];
  limits: { max_files: number; max_file_bytes: number };
}
export interface SourceSelection {
  project: ProjectMap;
  sources: SourceSnapshot[];
  exclusions: ContextExclusion[];
  replacements: {
    previous_id: string;
    current_id: string;
    reference: string;
  }[];
}
export interface SourceChange {
  previous: SourceRef;
  status: 'current' | 'modified' | 'deleted' | 'excluded';
  current: SourceSnapshot | null;
  reason: string;
}

export function redactContext(value: string): string {
  return value
    .replace(
      /("(?:\\.|[^"\\])*")(\s*:\s*)("(?:\\.|[^"\\])*")/g,
      (original: string, key: string, separator: string) => {
        let decoded: unknown;
        try {
          decoded = JSON.parse(key);
        } catch {
          return original;
        }
        return typeof decoded === 'string' &&
          /^(?:.*_)?(?:password|passwd|private[_-]?key|api[_-]?key|access[_-]?token|secret|token|authorization|bridge_env)$/i.test(
            decoded,
          )
          ? `${key}${separator}"[REDACTED]"`
          : original;
      },
    )
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .replace(
      /((?:password|private[_-]?key|api[_-]?key|access[_-]?token|secret|token)\s*[=:]\s*["']?)[^\s"',;]+/gi,
      '$1[REDACTED]',
    )
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}

function excludedPath(path: string): string | null {
  const parts = path.split('/');
  if (parts.some((part) => PRIVATE_DIRECTORIES.has(part)))
    return 'private_tool_or_credential_directory';
  if (parts.some((part) => OMIT_DIRECTORIES.has(part)))
    return 'generated_or_dependency_directory';
  const name = basename(path);
  if (
    /^\.env(?:\.|$)|^\.(?:npmrc|netrc|pypirc)$|^(?:credentials|secrets?)(?:\.|$)|^id_(?:rsa|ed25519|ecdsa)(?:\.|$)|\.(?:pem|key|p12|pfx|keystore)$/i.test(
      name,
    )
  )
    return 'sensitive_path';
  return null;
}

function safeRelative(path: string): string {
  if (
    typeof path !== 'string' ||
    path.includes('\0') ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    path.startsWith('\\') ||
    path.split(/[\\/]/).includes('..')
  )
    throw new CrewError(
      'INVALID_PATH',
      'Context paths must stay relative to the project',
      path,
    );
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

export function pathInScope(
  path: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((raw) => {
    const pattern = safeRelative(raw);
    return (
      pattern === '' ||
      pattern === '.' ||
      path === pattern ||
      path.startsWith(pattern + '/') ||
      matchesGlob(path, pattern)
    );
  });
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep))
  );
}

async function snapshot(
  map: ProjectMap,
  path: string,
  reason: string,
): Promise<SourceSnapshot> {
  const reference = safeRelative(path);
  const excluded = excludedPath(reference);
  if (excluded) throw new CrewError('EXCLUDED_SOURCE', excluded, reference);
  if (
    map.exclusions.some(
      (item) => item.reference === reference && item.reason === 'gitignore',
    )
  )
    throw new CrewError('EXCLUDED_SOURCE', 'gitignore', reference);
  const candidate = resolve(map.root, reference);
  const canonical = await realpath(candidate);
  if (!inside(map.root, canonical))
    throw new CrewError(
      'EXCLUDED_SOURCE',
      'symlink_outside_project',
      reference,
    );
  const handle = await open(
    canonical,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile())
      throw new CrewError('EXCLUDED_SOURCE', 'not_a_regular_file', reference);
    if (info.size > map.limits.max_file_bytes)
      throw new CrewError('EXCLUDED_SOURCE', 'file_size_limit', reference);
    const raw = await handle.readFile();
    if (raw.length > map.limits.max_file_bytes)
      throw new CrewError('EXCLUDED_SOURCE', 'file_size_limit', reference);
    if (
      raw.includes(0) ||
      !Buffer.from(raw.toString('utf8'), 'utf8').equals(raw)
    )
      throw new CrewError('EXCLUDED_SOURCE', 'binary_content', reference);
    if ((await realpath(candidate)) !== canonical)
      throw new CrewError(
        'SOURCE_CHANGED',
        'Source changed while being read',
        reference,
      );
    const content = redactContext(raw.toString('utf8'));
    const instruction = INSTRUCTIONS.has(basename(reference));
    const source: SourceRef = {
      id: `source:${sha256(map.root + '\0' + reference + '\0' + sha256(raw)).slice(0, 40)}`,
      kind: instruction
        ? 'instruction'
        : /(?:^|\/)docs?\/|\.md$/i.test(reference)
          ? 'documentation'
          : 'repo_file',
      reference,
      observed_at: map.observed_at,
      revision: `sha256:${sha256(raw)}`,
      authority: instruction ? 'applicable_instruction' : 'observed_code',
      summary: `${instruction ? 'Project instructions' : 'Observed file'}: ${reference}`,
    };
    validate('SourceRef', source);
    return {
      source,
      content,
      reason,
      redacted: content !== raw.toString('utf8'),
    };
  } finally {
    await handle.close();
  }
}

export async function inspectProject(
  cwd: string,
  options: {
    max_files?: number;
    max_file_bytes?: number;
    observed_at?: string;
  } = {},
): Promise<ProjectMap> {
  let root = await realpath(cwd);
  if (!(await stat(root)).isDirectory())
    throw new CrewError('INVALID_PROJECT', 'Project must be a directory');
  const git = {
    revision: null as string | null,
    status: null as string | null,
  };
  let gitPresent = false;
  const gitWarnings: string[] = [];
  try {
    const result = await execute(
      'git',
      ['-C', root, 'rev-parse', '--show-toplevel'],
      { timeout: 5000, maxBuffer: 1024 * 1024 },
    );
    root = await realpath(result.stdout.trim());
    gitPresent = true;
    const [revision, status] = await Promise.all([
      execute('git', ['-C', root, 'rev-parse', 'HEAD'], {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      }).catch(() => null),
      execute('git', ['-C', root, 'status', '--short'], {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      }),
    ]);
    git.revision = revision ? `git:${revision.stdout.trim()}` : null;
    git.status = redactContext(status.stdout.trim());
  } catch (failure) {
    const code = (failure as NodeJS.ErrnoException).code;
    if (gitPresent || code === 'ENOENT')
      gitWarnings.push(
        'Git state could not be fully inspected; its revision/status remain unknown',
      );
  }
  const map: ProjectMap = {
    root,
    observed_at: options.observed_at ?? now(),
    git,
    files: [],
    sources: [],
    commands: [],
    modules: [],
    exclusions: [],
    warnings: gitWarnings,
    limits: {
      max_files: options.max_files ?? 2000,
      max_file_bytes: options.max_file_bytes ?? 256 * 1024,
    },
  };
  if (
    !Number.isSafeInteger(map.limits.max_files) ||
    map.limits.max_files < 1 ||
    !Number.isSafeInteger(map.limits.max_file_bytes) ||
    map.limits.max_file_bytes < 1
  )
    throw new CrewError(
      'INVALID_INPUT',
      'Project inspection limits must be positive integers',
    );
  const visited = new Set<string>();
  let stopped = false;
  const walk = async (directory: string): Promise<void> => {
    if (stopped) return;
    const canonical = await realpath(join(root, directory));
    if (!inside(root, canonical)) {
      map.exclusions.push({
        reference: directory,
        reason: 'symlink_outside_project',
      });
      return;
    }
    if (visited.has(canonical)) {
      map.exclusions.push({
        reference: directory,
        reason: 'duplicate_or_cyclic_directory',
      });
      return;
    }
    visited.add(canonical);
    const entries = (
      await readdir(join(root, directory), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = directory ? directory + '/' + entry.name : entry.name;
      const excluded = excludedPath(path);
      if (excluded) {
        map.exclusions.push({ reference: path, reason: excluded });
        continue;
      }
      if (map.files.length >= map.limits.max_files) {
        stopped = true;
        map.warnings.push(
          'File inventory limit reached; request a narrower project inspection',
        );
        return;
      }
      try {
        const info = entry.isSymbolicLink()
          ? await stat(join(root, path))
          : await lstat(join(root, path));
        if (!inside(root, await realpath(join(root, path)))) {
          map.exclusions.push({
            reference: path,
            reason: 'symlink_outside_project',
          });
          continue;
        }
        if (info.isDirectory()) await walk(path);
        else if (info.isFile()) map.files.push(path);
        else
          map.exclusions.push({
            reference: path,
            reason: 'not_a_regular_file',
          });
      } catch {
        map.exclusions.push({
          reference: path,
          reason: 'unreadable_or_removed',
        });
      }
      if (stopped) return;
    }
  };
  await walk('');
  if (gitPresent && map.files.length > 0) {
    let ignored: string;
    try {
      ignored = await new Promise<string>((accept, reject) => {
        const checking = execFile(
          'git',
          ['-C', root, 'check-ignore', '--no-index', '-z', '--stdin'],
          { timeout: 5000, maxBuffer: 1024 * 1024 },
          (failure, stdout) => {
            if (failure && failure.code !== 1) reject(failure);
            else accept(stdout);
          },
        );
        checking.stdin!.end(map.files.join('\0') + '\0');
      });
    } catch {
      throw new CrewError(
        'PROJECT_INSPECTION_FAILED',
        'Git exclusions could not be checked; no file contents were loaded',
      );
    }
    const ignoredPaths = new Set(ignored.split('\0').filter(Boolean));
    map.files = map.files.filter((path) => {
      if (!ignoredPaths.has(path) || INSTRUCTIONS.has(basename(path)))
        return true;
      map.exclusions.push({ reference: path, reason: 'gitignore' });
      return false;
    });
  }
  for (const path of map.files.filter(
    (path) =>
      !path.includes('/') &&
      (MANIFESTS.has(path) ||
        INSTRUCTIONS.has(path) ||
        /^README(?:\.|$)/i.test(path)),
  )) {
    try {
      map.sources.push(
        await snapshot(
          map,
          path,
          INSTRUCTIONS.has(path)
            ? 'root_project_instruction'
            : 'project_identity_and_commands',
        ),
      );
    } catch (failure) {
      map.exclusions.push({
        reference: path,
        reason:
          failure instanceof CrewError
            ? failure.message
            : 'unreadable_or_removed',
      });
    }
  }
  const packageSource = map.sources.find(
    (item) => item.source.reference === 'package.json',
  );
  if (packageSource) {
    try {
      const manifest: unknown = JSON.parse(packageSource.content);
      const scripts =
        manifest && typeof manifest === 'object' && 'scripts' in manifest
          ? manifest.scripts
          : null;
      if (scripts && typeof scripts === 'object' && !Array.isArray(scripts))
        map.commands = Object.keys(scripts)
          .sort()
          .map((name) => ({
            command: `npm run ${name}`,
            source_id: packageSource.source.id,
          }));
    } catch {
      map.warnings.push(
        'package.json could not be parsed; no commands inferred',
      );
    }
  }
  map.modules = [
    ...new Set(
      map.files
        .filter((file) => file.includes('/'))
        .map((file) => file.split('/')[0]!),
    ),
  ].sort();
  map.files.sort();
  return map;
}

export async function selectTaskSources(
  project: ProjectMap,
  task: TaskSpec,
  previousSources: readonly SourceRef[] = [],
): Promise<SourceSelection> {
  validate('TaskSpec', task);
  for (const path of [
    ...task.scope.read_paths,
    ...task.scope.write_paths,
    ...task.scope.excluded_paths,
  ])
    safeRelative(path);
  const selection: SourceSelection = {
    project,
    sources: [],
    exclusions: [...project.exclusions],
    replacements: [],
  };
  const previous = new Map(
    previousSources.map((source) => [source.id, source]),
  );
  const selectedPaths = project.files.filter(
    (path) =>
      pathInScope(path, task.scope.read_paths) &&
      !pathInScope(path, task.scope.excluded_paths),
  );
  const paths = new Map<string, string>(
    selectedPaths.map((path) => [path, 'task_read_scope']),
  );
  for (const source of project.sources)
    if (source.source.kind !== 'instruction')
      paths.set(source.source.reference, 'project_identity_and_commands');
  for (const id of task.context_source_ids) {
    const source =
      project.sources.find((item) => item.source.id === id)?.source ??
      previous.get(id);
    if (!source)
      throw new CrewError(
        'CONTEXT_SOURCE_MISSING',
        `Required context source is unavailable: ${id}`,
      );
    if (!['repo_file', 'instruction', 'documentation'].includes(source.kind))
      throw new CrewError(
        'INVALID_SOURCE',
        'File selection requires repository source references',
        id,
      );
    if (pathInScope(source.reference, task.scope.excluded_paths))
      throw new CrewError(
        'EXCLUDED_SOURCE',
        'Required context source is excluded by task scope',
        source.reference,
      );
    paths.set(source.reference, `required_source:${id}`);
  }
  const scopePaths = [
    ...selectedPaths,
    ...task.scope.read_paths,
    ...task.scope.write_paths,
  ].map((path) => safeRelative(path));
  for (const path of project.files.filter((file) =>
    INSTRUCTIONS.has(basename(file)),
  )) {
    const directory = dirname(path).replaceAll('\\', '/');
    if (
      directory === '.' ||
      scopePaths.some(
        (scope) =>
          scope === directory ||
          scope.startsWith(directory + '/') ||
          pathInScope(directory, [scope]),
      )
    )
      if (!paths.get(path)?.startsWith('required_source:'))
        paths.set(path, 'applicable_project_instruction');
  }
  for (const [path, reason] of [...paths].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    try {
      const source = await snapshot(project, path, reason);
      selection.sources.push(source);
      const old = reason.startsWith('required_source:')
        ? previous.get(reason.slice('required_source:'.length))
        : undefined;
      if (old && old.id !== source.source.id)
        selection.replacements.push({
          previous_id: old.id,
          current_id: source.source.id,
          reference: path,
        });
    } catch (failure) {
      const detail =
        failure instanceof CrewError
          ? failure.message
          : 'unreadable_or_removed';
      if (
        reason.startsWith('required_source:') ||
        INSTRUCTIONS.has(basename(path))
      )
        throw new CrewError(
          'CONTEXT_SOURCE_UNAVAILABLE',
          `Required source cannot be read: ${path} (${detail})`,
        );
      selection.exclusions.push({ reference: path, reason: detail });
    }
  }
  for (const path of project.files)
    if (!paths.has(path))
      selection.exclusions.push({
        reference: path,
        reason: pathInScope(path, task.scope.excluded_paths)
          ? 'task_scope_exclusion'
          : 'not_relevant_to_task',
      });
  return selection;
}

export async function reconcileSources(
  previous: readonly SourceRef[],
  project: ProjectMap,
  tasks: readonly TaskSpec[] = [],
): Promise<{ changes: SourceChange[]; affected_task_ids: string[] }> {
  const changes: SourceChange[] = [];
  for (const source of previous.filter((source) =>
    ['repo_file', 'instruction', 'documentation'].includes(source.kind),
  )) {
    try {
      const current = await snapshot(
        project,
        source.reference,
        'source_revalidation',
      );
      changes.push({
        previous: source,
        status:
          current.source.revision === source.revision ? 'current' : 'modified',
        current,
        reason:
          current.source.revision === source.revision
            ? 'content_hash_unchanged'
            : 'content_hash_changed',
      });
    } catch (failure) {
      changes.push({
        previous: source,
        status:
          failure instanceof CrewError && failure.code === 'EXCLUDED_SOURCE'
            ? 'excluded'
            : 'deleted',
        current: null,
        reason:
          failure instanceof CrewError
            ? failure.message
            : 'unreadable_or_removed',
      });
    }
  }
  const affected = changes.filter((change) => change.status !== 'current');
  return {
    changes,
    affected_task_ids: tasks
      .filter((task) =>
        affected.some(
          (change) =>
            task.context_source_ids.includes(change.previous.id) ||
            pathInScope(change.previous.reference, [
              ...task.scope.read_paths,
              ...task.scope.write_paths,
            ]),
        ),
      )
      .map((task) => task.id),
  };
}
