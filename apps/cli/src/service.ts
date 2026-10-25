import { spawn } from 'node:child_process';
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  CrewError,
  ident,
  validate,
} from '../../../packages/contracts/src/index.ts';
import type {
  Message,
  Project,
  ToolCall,
} from '../../../packages/contracts/src/index.ts';
import { SupervisorClient } from '../../../packages/supervisor/src/client.ts';

export function serviceArguments(
  projectRoot: string,
  entry = fileURLToPath(
    new URL('../../../packages/supervisor/src/main.js', import.meta.url),
  ),
): string[] {
  return [entry, '--project', projectRoot];
}
function ownerCapability(project: Project): string {
  const path = join(project.data_dir, 'owner.key');
  let fd: number | undefined;
  try {
    const info = lstatSync(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      info.size > 8192
    )
      throw new CrewError(
        'PRIVATE_FILE_INVALID',
        'La clé locale doit être un fichier privé régulier.',
      );
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const key = readFileSync(fd, 'utf8');
    if (!/^[A-Za-z0-9_-]{43}$/.test(key))
      throw new CrewError(
        'PRIVATE_FILE_INVALID',
        'La clé locale est invalide.',
      );
    return key;
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException).code === 'ENOENT')
      throw new CrewError(
        'SUPERVISOR_UNAVAILABLE',
        'Service absent ; utiliser avity-crew service start.',
      );
    throw failure;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export function userClient(
  project: Project,
  timeout_ms?: number,
): SupervisorClient {
  return new SupervisorClient({
    endpointFile: join(project.data_dir, 'endpoint.json'),
    capability: ownerCapability(project),
    ...(timeout_ms === undefined ? {} : { timeout_ms }),
  });
}
export async function ensureService(
  project: Project,
  entry?: string,
): Promise<SupervisorClient> {
  try {
    const client = userClient(project, 500);
    await client.admin({ method: 'status', arguments: {} });
    return userClient(project);
  } catch (failure) {
    if (
      !(failure instanceof CrewError) ||
      failure.code !== 'SUPERVISOR_UNAVAILABLE'
    )
      throw failure;
  }
  const argv = serviceArguments(project.root, entry);
  if (!existsSync(argv[0]!))
    throw new CrewError(
      'SERVICE_NOT_BUILT',
      'Entrée du service absente ; construire ou réinstaller Avity Crew.',
    );
  const log = join(project.data_dir, 'service.log');
  if (existsSync(log)) {
    const info = lstatSync(log);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
      throw new CrewError(
        'PRIVATE_FILE_INVALID',
        'Le journal du service doit rester privé.',
      );
  }
  const fd = openSync(
    log,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_APPEND |
      constants.O_NOFOLLOW,
    0o600,
  );
  const env = { ...process.env };
  delete env.AVITY_CREW_CAPABILITY;
  delete env.AVITY_CREW_ENDPOINT_FILE;
  delete env.AVITY_CREW_RUN_ID;
  try {
    const child = spawn(process.execPath, argv, {
      cwd: project.root,
      env,
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    child.on('error', () => {});
    child.unref();
  } finally {
    closeSync(fd);
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const client = userClient(project, 500);
      await client.admin({ method: 'status', arguments: {} });
      return userClient(project);
    } catch (failure) {
      if (
        !(failure instanceof CrewError) ||
        failure.code !== 'SUPERVISOR_UNAVAILABLE'
      )
        throw failure;
    }
    await delay(100);
  }
  throw new CrewError(
    'SUPERVISOR_UNAVAILABLE',
    `Service non prêt après 10 s ; consulter ${log}. Aucun objectif n’a été envoyé.`,
  );
}
/** Same `send_message` ToolCall as the domain/MCP route, with explicit request identity. */
export async function sendMessage(
  client: SupervisorClient,
  runId: string,
  content: string,
  to = 'chief',
  kind = 'information',
): Promise<unknown> {
  const status = (await client.admin({
    method: 'status',
    arguments: { run_id: runId, after_seq: 0, limit: 1 },
  })) as { run?: { version?: number } };
  if (!Number.isSafeInteger(status.run?.version))
    throw new CrewError(
      'NOT_READY',
      'Version du run indisponible ; message non envoyé.',
    );
  const call: ToolCall = {
    schema_version: 1,
    request_id: ident('request'),
    idempotency_key: ident('message'),
    run_id: runId,
    expected_version: status.run!.version!,
    method: 'send_message',
    arguments: {
      recipient_kind:
        to === 'chief' ? 'chief' : to === 'user:local' ? 'user' : 'task',
      recipient_id: to === 'chief' ? 'chief:current' : to,
      kind: kind as Message['kind'],
      content,
      source_ids: [],
      requires_ack: true,
    },
  };
  validate('ToolCall', call);
  const result = await client.execute(call);
  return {
    request_id: call.request_id,
    idempotency_key: call.idempotency_key,
    result,
  };
}
