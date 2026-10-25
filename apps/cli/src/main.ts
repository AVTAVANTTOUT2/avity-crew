import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  CrewError,
  ident,
  validate,
} from '../../../packages/contracts/src/index.ts';
import type {
  Message,
  ToolCall,
} from '../../../packages/contracts/src/index.ts';
import { identifyProject } from '../../../packages/storage/src/index.ts';
import { SupervisorClient } from '../../../packages/supervisor/src/client.ts';
import { runMcpFromEnv } from '../../../packages/supervisor/src/mcp.ts';
import { MAX_JSON_BYTES } from '../../../packages/supervisor/src/protocol.ts';
import { parseCli } from './args.ts';
import type { CliCommand } from './args.ts';
import { ensureService, userClient } from './service.ts';
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
async function message(
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
async function wizard(command: CliCommand, cwd: string): Promise<number> {
  const project = identifyProject(
    command.project ? resolve(cwd, command.project) : cwd,
  );
  const client = await ensureService(project);
  const current = (await client.admin({ method: 'status', arguments: {} })) as {
    run?: { status?: string };
  };
  if (
    current.run &&
    !['completed', 'failed', 'cancelled'].includes(current.run.status ?? '')
  )
    return watchRun(client, command, {
      answer: (question_id, answer, run_id) =>
        client.admin({
          method: 'answer',
          arguments: { run_id, question_id, answer },
        }),
      message: (content, runId) => message(client, runId, content),
    });
  output(await client.admin({ method: 'doctor', arguments: {} }), false);
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  rl.on('SIGINT', () => rl.close());
  const inputLines = rl[Symbol.asyncIterator]();
  const ask = async (prompt: string): Promise<string> => {
    try {
      rl.setPrompt(prompt);
      rl.prompt();
      const line = await inputLines.next();
      if (line.done) throw new Error('input closed');
      if (Buffer.byteLength(line.value) > MAX_JSON_BYTES)
        throw new CrewError('CLI_USAGE', 'Ligne supérieure à 1 MiB.');
      return line.value;
    } catch (failure) {
      if (failure instanceof CrewError) throw failure;
      throw new CrewError(
        'CLI_INTERRUPTED',
        'Saisie annulée ; aucun objectif envoyé.',
      );
    }
  };
  let parsed: CliCommand;
  try {
    process.stdout.write(
      'Objectif multiligne : une ligne contenant . termine la saisie.\n',
    );
    const lines: string[] = [];
    let goalBytes = 0;
    let line: string;
    while ((line = await ask('objectif> ')) !== '.') {
      goalBytes += Buffer.byteLength(line) + 1;
      if (goalBytes > MAX_JSON_BYTES)
        throw new CrewError('CLI_USAGE', 'Objectif supérieur à 1 MiB.');
      lines.push(line);
    }
    const criteria: string[] = [];
    while (true) {
      const criterion = await ask(
        criteria.length
          ? 'Autre critère (Entrée termine)> '
          : 'Critère observable obligatoire> ',
      );
      if (!criterion.trim() && criteria.length) break;
      if (criterion.trim()) criteria.push(criterion);
    }
    const chief = (
      await ask('Chef claude/codex (Entrée = configuration)> ')
    ).trim();
    const model = (await ask('Modèle (Entrée = configuration)> ')).trim();
    parsed = parseCli([
      'run',
      ...criteria.flatMap((criterion) => ['--criterion', criterion]),
      ...(chief ? ['--chief', chief] : []),
      ...(model ? ['--model', model] : []),
      ...(command.project ? ['--project', command.project] : []),
      '--',
      lines.join('\n'),
    ]);
  } finally {
    rl.close();
  }
  return execute(parsed, cwd);
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
      ? wizard(command, cwd)
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
    result = await admin('create_run', {
      objective: goal,
      criteria: command.criteria,
      constraints: command.constraints,
      ...(command.chief ? { chief_provider: command.chief } : {}),
      ...(command.model ? { chief_model: command.model } : {}),
      ...(command.maxAgents ? { max_active_agents: command.maxAgents } : {}),
      delivery_mode: command.mode ?? 'code',
      ...(command.initGit ? { initialize_git: true } : {}),
    });
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
    result = await message(
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
    return watchRun(client, command, {
      answer: (question_id, answer, run_id) =>
        admin('answer', { run_id, question_id, answer }),
      message: (content, runId) => message(client, runId, content),
    });
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
    return watchRun(
      client,
      { ...command, name: 'attach', run: runId },
      {
        answer: (question_id, answer, run_id) =>
          admin('answer', { run_id, question_id, answer }),
        message: (content, id) => message(client, id, content),
      },
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
