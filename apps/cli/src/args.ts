import { CrewError } from '../../../packages/contracts/src/index.ts';

export interface CliCommand {
  name: string;
  json: boolean;
  project?: string;
  run?: string;
  text?: string;
  promptFile?: string;
  criteria: string[];
  constraints: string[];
  chief?: 'claude' | 'codex';
  model?: string;
  maxAgents?: number;
  mode?: 'code' | 'documentation';
  initGit: boolean;
  subject?: string;
  question?: string;
  task?: string;
  to?: string;
  kind?: string;
  format?: 'json' | 'markdown';
  afterSeq: number;
  limit: number;
  timeout: number;
  once: boolean;
}
const aliases: Record<string, string> = {
  'switch-chief': 'replace-chief',
  context: 'inspect-context',
  report: 'export',
  bridge: 'internal-mcp',
  list: 'list',
};
const identifier = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
function usage(message: string): never {
  throw new CrewError('CLI_USAGE', message);
}
export function parseCli(argv: readonly string[]): CliCommand {
  const args = [...argv];
  let name = args.shift() ?? 'interactive';
  if (name === '--help' || name === '-h' || name === 'help') name = 'help';
  if (name === '--version') name = 'version';
  if (name === 'service' || name === 'internal')
    name += '-' + (args.shift() ?? '');
  name = aliases[name] ?? name;
  const allowed: Record<string, string[]> = {
    interactive: [],
    help: [],
    version: [],
    init: [],
    run: [
      'criterion',
      'constraint',
      'chief',
      'model',
      'max-agents',
      'mode',
      'init-git',
      'prompt-file',
    ],
    status: ['run', 'after-seq', 'limit'],
    list: [],
    attach: ['run', 'after-seq', 'limit', 'timeout', 'once'],
    watch: ['run', 'after-seq', 'limit', 'timeout', 'once'],
    answer: ['run', 'question'],
    message: ['run', 'to', 'kind'],
    pause: ['run'],
    resume: ['run'],
    stop: ['run'],
    'replace-chief': ['run', 'provider', 'chief', 'model'],
    reassign: ['run', 'task'],
    'inspect-context': ['run', 'subject', 'task'],
    export: ['run', 'format'],
    doctor: [],
    'service-start': [],
    'service-status': [],
    'service-stop': [],
    'internal-call': [],
    'internal-mcp': [],
  };
  if (!(name in allowed)) usage('Commande inconnue ; consulter --help.');
  const command: CliCommand = {
    name,
    json: false,
    criteria: [],
    constraints: [],
    initGit: false,
    afterSeq: 0,
    limit: 100,
    timeout: 0,
    once: false,
  };
  const seen = new Set<string>();
  const positional: string[] = [];
  while (args.length) {
    const arg = args.shift()!;
    if (arg === '--') {
      positional.push(...args);
      break;
    }
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const split = arg.indexOf('=');
    const flag = arg.slice(2, split < 0 ? undefined : split);
    if (!['json', 'project', ...allowed[name]!].includes(flag))
      usage(`Option --${flag} non disponible pour ${name}.`);
    if (seen.has(flag) && !['criterion', 'constraint'].includes(flag))
      usage(`Option --${flag} répétée.`);
    seen.add(flag);
    if (['json', 'init-git', 'once'].includes(flag)) {
      if (split >= 0) usage(`--${flag} ne prend pas de valeur.`);
      if (flag === 'json') command.json = true;
      else if (flag === 'once') command.once = true;
      else command.initGit = true;
      continue;
    }
    const value = split < 0 ? args.shift() : arg.slice(split + 1);
    if (!value || value.startsWith('--') || !value.trim())
      usage(`Valeur requise pour --${flag}.`);
    if (flag === 'criterion') command.criteria.push(value);
    else if (flag === 'constraint') command.constraints.push(value);
    else if (['max-agents', 'after-seq', 'limit', 'timeout'].includes(flag)) {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
        usage(`--${flag} doit être un entier.`);
      const number = Number(value);
      if (
        (flag === 'max-agents' && (number < 1 || number > 64)) ||
        (flag === 'limit' && (number < 1 || number > 1000)) ||
        (flag === 'timeout' && number < 1)
      )
        usage(`Valeur hors limites pour --${flag}.`);
      if (flag === 'max-agents') command.maxAgents = number;
      else if (flag === 'after-seq') command.afterSeq = number;
      else if (flag === 'limit') command.limit = number;
      else command.timeout = number;
    } else if (flag === 'chief' || flag === 'provider') {
      if (value !== 'claude' && value !== 'codex')
        usage('Le chef doit être claude ou codex.');
      if (command.chief) usage('Choisir un seul provider de chef.');
      command.chief = value;
    } else if (flag === 'mode') {
      if (value !== 'code' && value !== 'documentation')
        usage('Le mode doit être code ou documentation.');
      command.mode = value;
    } else if (flag === 'format') {
      if (value !== 'json' && value !== 'markdown')
        usage('Le format doit être json ou markdown.');
      command.format = value;
    } else if (flag === 'project') command.project = value;
    else if (flag === 'run') command.run = value;
    else if (flag === 'model') command.model = value;
    else if (flag === 'prompt-file') command.promptFile = value;
    else if (flag === 'question') command.question = value;
    else if (flag === 'subject') command.subject = value;
    else if (flag === 'task') command.task = value;
    else if (flag === 'to') command.to = value;
    else if (flag === 'kind') command.kind = value;
  }
  if (['run', 'answer', 'message'].includes(name))
    command.text = positional.join(' ').trim();
  else if (positional.length) usage('Argument positionnel inattendu.');
  if (
    name === 'run' &&
    ((!command.text && !command.promptFile) ||
      (command.text && command.promptFile) ||
      command.criteria.length === 0)
  )
    usage(
      'run exige un objectif (texte, - ou --prompt-file) et au moins un --criterion explicite.',
    );
  if (command.initGit && command.mode === 'documentation')
    usage('--init-git ne s’applique pas au mode documentation.');
  if (
    [
      'answer',
      'message',
      'pause',
      'resume',
      'stop',
      'replace-chief',
      'reassign',
      'inspect-context',
      'export',
    ].includes(name) &&
    !command.run
  )
    usage(`--run est requis pour ${name}.`);
  if (name === 'answer' && (!command.question || !command.text))
    usage('answer exige --question et une réponse.');
  if (name === 'message' && !command.text) usage('message exige un texte.');
  if (name === 'replace-chief' && !command.chief)
    usage('replace-chief exige --provider claude|codex.');
  if (name === 'reassign' && !command.task) usage('reassign exige --task.');
  if (name === 'inspect-context' && !(command.subject ?? command.task))
    usage('inspect-context exige --subject ou --task.');
  for (const id of [
    command.run,
    command.question,
    command.subject,
    command.task,
  ])
    if (id && !identifier.test(id)) usage('Identifiant invalide.');
  if (
    command.kind &&
    ![
      'information',
      'decision_update',
      'question',
      'blocker',
      'correction',
    ].includes(command.kind)
  )
    usage('Type de message invalide.');
  if (
    command.to &&
    command.to !== 'chief' &&
    command.to !== 'user:local' &&
    !(command.to.startsWith('task:') && identifier.test(command.to.slice(5)))
  )
    usage('--to attend chief, task:ID ou user:local.');
  if (name.startsWith('internal-') && (command.json || command.project))
    usage(
      'Les commandes internal utilisent uniquement leur environnement et stdin.',
    );
  return command;
}
