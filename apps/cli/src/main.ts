import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CrewError, validate } from '../../../packages/contracts/src/index.ts';
import type { ToolCall } from '../../../packages/contracts/src/index.ts';
import { identifyProject } from '../../../packages/storage/src/index.ts';
import { SupervisorClient } from '../../../packages/supervisor/src/client.ts';
import { runMcpFromEnv } from '../../../packages/supervisor/src/mcp.ts';
import { MAX_JSON_BYTES } from '../../../packages/supervisor/src/protocol.ts';
import { parseCli, runArguments } from './args.ts';
import type { CliCommand } from './args.ts';
import { ensureService, sendMessage, userClient } from './service.ts';
import { runTui } from './tui/app.ts';
import { cleanText, renderSnapshot, watchRun } from './view.ts';

const VERSION = '0.1.0'; // x-release-please-version

export const HELP = `Avity Crew ${VERSION} — équipe locale Claude Code / Codex

avity-crew                         Conversation interactive du projet courant
avity-crew init | doctor | status [--run ID] [--json] | list
avity-crew run "objectif" --criterion "preuve attendue" [--constraint texte]
  --chief claude|codex --model ID --max-agents N --mode code|documentation
  --init-git (explicite, code seulement) ; --prompt-file fichier ou run - pour stdin
avity-crew attach|watch [--run ID] [--after-seq N] [--once] [--timeout MS]
avity-crew answer --run ID --question ID "réponse"
avity-crew message --run ID [--to chief|task:ID|user:local] [--kind information] "texte"
avity-crew pause|resume|stop --run ID
avity-crew replace-chief --run ID --provider claude|codex [--model ID]
avity-crew reassign --run ID --task ID
avity-crew inspect-context --run ID --subject ID
avity-crew export --run ID [--format json|markdown]
avity-crew service start|status|stop

Options communes : --project chemin, --json. Quitter une vue détache seulement.
Internal : internal call (ToolCall stdin), internal mcp (ENV de capability requis).
Une commande acceptée ne prouve pas qu'un objectif est terminé ; voir son état et ses preuves.`;

function output(data: unknown, json: boolean): void {
  if (json)
    process.stdout.write(
      JSON.stringify({ schema_version: 1, ok: true, data }) + '\n',
    );
  else if (data && typeof data === 'object' && 'tasks' in data && 'run' in data)
    process.stdout.write(
      renderSnapshot(data, process.stdout.columns ?? 120, 100) + '\n',
    );
  else
    process.stdout.write(
      cleanText(
        typeof data === 'string' ? data : JSON.stringify(data, null, 2),
        true,
      ) + '\n',
    );
}
async function stdinText(): Promise<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0,
    text = '';
  for await (const chunk of process.stdin) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > MAX_JSON_BYTES)
      throw new CrewError('CLI_USAGE', 'Entrée stdin supérieure à 1 MiB.');
    try {
      text += decoder.decode(value, { stream: true });
    } catch {
      throw new CrewError('CLI_USAGE', 'Entrée stdin UTF-8 invalide.');
    }
  }
  try {
    return text + decoder.decode();
  } catch {
    throw new CrewError('CLI_USAGE', 'Entrée stdin UTF-8 incomplète.');
  }
}
async function objective(command: CliCommand, cwd: string): Promise<string> {
  let value = command.text ?? '';
  if (command.promptFile) {
    const path = resolve(cwd, command.promptFile);
    if ((await stat(path)).size > MAX_JSON_BYTES)
      throw new CrewError('CLI_USAGE', 'Le fichier objectif dépasse 1 MiB.');
    const bytes = await readFile(path);
    if (bytes.length > MAX_JSON_BYTES)
      throw new CrewError('CLI_USAGE', 'Le fichier objectif dépasse 1 MiB.');
    try {
      value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new CrewError(
        'CLI_USAGE',
        'Le fichier objectif doit être UTF-8 valide.',
      );
    }
  } else if (value === '-') value = await stdinText();
  if (!value.trim()) throw new CrewError('CLI_USAGE', 'Objectif vide.');
  if (Buffer.byteLength(value) > MAX_JSON_BYTES)
    throw new CrewError('CLI_USAGE', 'Objectif supérieur à 1 MiB.');
  return value;
}
/** Terminal views open the full-screen interface; scripts keep the JSON/once watcher. */
function view(
  client: SupervisorClient,
  command: CliCommand,
  project: string,
): Promise<number> {
  if (
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    !command.json &&
    !command.once
  )
    return runTui(client, { project, run: command.run ?? null });
  return watchRun(client, command);
}
async function interactive(command: CliCommand, cwd: string): Promise<number> {
  const project = identifyProject(
    command.project ? resolve(cwd, command.project) : cwd,
  );
  const client = await ensureService(project);
  const current = (await client.admin({ method: 'status', arguments: {} })) as {
    run?: { id?: string; status?: string };
  };
  const active =
    current.run &&
    !['completed', 'failed', 'cancelled'].includes(current.run.status ?? '')
      ? (current.run.id ?? null)
      : null;
  return runTui(client, { project: project.root, run: active, home: !active });
}
async function execute(command: CliCommand, cwd: string): Promise<number> {
  if (command.name === 'help') {
    output(HELP, command.json);
    return 0;
  }
  if (command.name === 'version') {
    output(VERSION, command.json);
    return 0;
  }
  if (command.name === 'internal-mcp') {
    await runMcpFromEnv();
    return 0;
  }
  if (command.name === 'internal-call') {
    const endpointFile = process.env.AVITY_CREW_ENDPOINT_FILE,
      capability = process.env.AVITY_CREW_CAPABILITY;
    if (!endpointFile || !capability)
      throw new CrewError('CLI_USAGE', 'ENV endpoint et capability requises.');
    let call: unknown;
    try {
      call = JSON.parse(await stdinText());
    } catch (failure) {
      if (failure instanceof CrewError) throw failure;
      throw new CrewError('CLI_USAGE', 'ToolCall JSON invalide sur stdin.');
    }
    validate('ToolCall', call);
    output(
      await new SupervisorClient({ endpointFile, capability }).execute(
        call as ToolCall,
      ),
      true,
    );
    return 0;
  }
  if (command.name === 'interactive')
    return process.stdin.isTTY && process.stdout.isTTY
      ? interactive(command, cwd)
      : (output(HELP, command.json), 0);
  const goal = command.name === 'run' ? await objective(command, cwd) : null;
  const project = identifyProject(
    command.project ? resolve(cwd, command.project) : cwd,
  );
  const client = ['init', 'run', 'service-start', 'doctor'].includes(
    command.name,
  )
    ? await ensureService(project)
    : userClient(project);
  const admin = (method: string, args: Record<string, unknown>) =>
    client.admin({ method, arguments: args });
  let result: unknown;
  if (command.name === 'run')
    result = await admin('create_run', runArguments(command, goal!));
  else if (command.name === 'init' || command.name === 'service-start')
    result = {
      service: 'ready',
      project: project.root,
      status: await admin('status', {}),
    };
  else if (command.name === 'status' || command.name === 'service-status')
    result = await admin('status', {
      ...(command.run ? { run_id: command.run } : {}),
      after_seq: command.afterSeq,
      limit: command.limit,
    });
  else if (command.name === 'list') result = await admin('list_runs', {});
  else if (command.name === 'doctor') result = await admin('doctor', {});
  else if (command.name === 'service-stop')
    result = await admin('shutdown', {});
  else if (command.name === 'answer')
    result = await admin('answer', {
      run_id: command.run,
      question_id: command.question,
      answer: command.text,
    });
  else if (command.name === 'message')
    result = await sendMessage(
      client,
      command.run!,
      command.text!,
      command.to,
      command.kind,
    );
  else if (['pause', 'resume', 'stop'].includes(command.name))
    result = await admin(command.name, { run_id: command.run });
  else if (command.name === 'replace-chief')
    result = await admin('replace_chief', {
      run_id: command.run,
      provider: command.chief,
      model: command.model ?? null,
    });
  else if (command.name === 'reassign')
    result = await admin('reassign', {
      run_id: command.run,
      task_id: command.task,
    });
  else if (command.name === 'inspect-context')
    result = await admin('inspect_context', {
      run_id: command.run,
      subject_id: command.subject ?? command.task,
    });
  else if (command.name === 'export')
    result = await admin('export', {
      run_id: command.run,
      format: command.format ?? 'markdown',
    });
  else if (command.name === 'attach' || command.name === 'watch')
    return view(client, command, project.root);
  else throw new CrewError('CLI_USAGE', 'Commande non disponible.');
  output(result, command.json);
  if (
    command.name === 'run' &&
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    !command.json
  ) {
    const runId =
      result &&
      typeof result === 'object' &&
      'id' in result &&
      typeof result.id === 'string'
        ? result.id
        : null;
    if (!runId)
      throw new CrewError(
        'TRANSPORT_PROTOCOL_ERROR',
        'Objectif enregistré sans identité lisible ; consulter status avant toute nouvelle demande.',
      );
    return view(
      client,
      { ...command, name: 'attach', run: runId },
      project.root,
    );
  }
  return 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const json = args.includes('--json');
  try {
    return await execute(parseCli(args), process.cwd());
  } catch (failure) {
    const code = failure instanceof CrewError ? failure.code : 'CLI_ERROR';
    const message =
      failure instanceof CrewError
        ? cleanText(failure.message)
        : 'Commande non exécutée ; vérifier le projet et les prérequis avec doctor.';
    if (json)
      process.stdout.write(
        JSON.stringify({
          schema_version: 1,
          ok: false,
          error: { code, message },
        }) + '\n',
      );
    else process.stderr.write(`${code} : ${message}\n`);
    return code === 'CLI_USAGE' || code === 'INVALID_INPUT'
      ? 2
      : code === 'CLI_INTERRUPTED'
        ? 130
        : [
              'SUPERVISOR_UNAVAILABLE',
              'FORBIDDEN',
              'REVOKED_CAPABILITY',
              'PRIVATE_FILE_INVALID',
              'SERVICE_NOT_BUILT',
            ].includes(code)
          ? 3
          : 1;
  }
}
