import { states } from '../view.ts';
import type { Tone } from './term.ts';

export type Rec = Record<string, unknown>;
export const rec = (value: unknown): Rec =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Rec)
    : {};
export const list = (value: unknown): Rec[] =>
  Array.isArray(value) ? value.map(rec) : [];
export const str = (value: unknown): string | null =>
  typeof value === 'string' && value
    ? value
    : typeof value === 'number'
      ? String(value)
      : null;

export const providerLabel = (provider: string | null): string =>
  provider === 'claude'
    ? 'Claude Code'
    : provider === 'codex'
      ? 'Codex'
      : provider === 'fake'
        ? 'simulation (fake)'
        : 'fournisseur non attribué';
const roles: Record<string, [short: string, label: string]> = {
  developer: ['dev', 'développeur'],
  reviewer: ['relecture', 'relecteur'],
  validator: ['validation', 'validateur'],
  documenter: ['doc', 'rédacteur'],
  investigator: ['enquête', 'enquêteur'],
  refactorer: ['refacto', 'refactoriste'],
  ci: ['ci', 'intégration continue'],
};
export const stateLabel = (status: string | null): string =>
  status ? (states[status] ?? status) : 'état indisponible';
/** Every state keeps a symbol and words, so colour is never the only signal. */
export function stateMark(status: string | null): [string, Tone] {
  if (!status) return ['?', 'dim'];
  if (['accepted', 'completed'].includes(status)) return ['✓', 'green'];
  if (status === 'failed') return ['✗', 'red'];
  if (status === 'blocked') return ['■', 'red'];
  if (status === 'cancelled') return ['⊘', 'dim'];
  if (status === 'paused') return ['‖', 'yellow'];
  if (
    [
      'planned',
      'ready',
      'queued',
      'waiting_dependency',
      'waiting_user',
      'waiting_provider',
      'changes_requested',
    ].includes(status)
  )
    return ['◌', 'yellow'];
  return ['●', 'text'];
}
export const messageStatus: Record<string, string> = {
  queued: 'enregistré',
  delivered: 'transmis',
  acknowledged: 'reçu',
  applied: 'prise en compte déclarée',
  failed: 'échec',
};
const messageKinds: Record<string, string> = {
  information: 'information',
  decision_update: 'décision',
  question: 'question',
  blocker: 'blocage',
  correction: 'correction',
};

export interface RunData {
  id: string;
  run: Rec | null;
  project: Rec;
  tasks: Rec[];
  sessions: Rec[];
  questions: Rec[];
  decisions: Rec[];
  verifications: Rec[];
  blockers: Rec[];
  activity: { active: Rec[]; queued: Rec[] } | null;
  events: Rec[];
  cursor: number;
  messages: Rec[];
  delegations: Rec[];
  responses: Rec[];
  handoffs: Rec[];
  reviews: Rec[];
  loaded: boolean;
  /** Export records (handoffs/reviews) are refreshed only after related events. */
  exportWanted: boolean;
}
const MAX_EVENTS = 4000;
export function emptyRun(id: string): RunData {
  return {
    id,
    run: null,
    project: {},
    tasks: [],
    sessions: [],
    questions: [],
    decisions: [],
    verifications: [],
    blockers: [],
    activity: null,
    events: [],
    cursor: 0,
    messages: [],
    delegations: [],
    responses: [],
    handoffs: [],
    reviews: [],
    loaded: false,
    exportWanted: true,
  };
}
/** Merges one `status` page; returns the events not seen before. */
export function applyStatus(data: RunData, snapshot: unknown): Rec[] {
  const page = rec(snapshot);
  data.run = page.run ? rec(page.run) : null;
  data.project = rec(page.project);
  data.tasks = list(page.tasks);
  data.sessions = list(page.sessions);
  data.questions = list(page.questions);
  data.decisions = list(page.decisions);
  data.verifications = list(page.verifications);
  data.blockers = list(page.blockers);
  const activity = rec(page.activity);
  data.activity =
    Array.isArray(activity.active) || Array.isArray(activity.queued)
      ? { active: list(activity.active), queued: list(activity.queued) }
      : null;
  const fresh = list(page.events).filter(
    (event) => typeof event.seq === 'number' && event.seq > data.cursor,
  );
  for (const event of fresh) {
    data.events.push(event);
    data.cursor = Math.max(data.cursor, event.seq as number);
    if (
      [
        'handoff.submitted',
        'review.submitted',
        'task.accepted',
        'question.answered',
      ].includes(String(event.type))
    )
      data.exportWanted = true;
  }
  if (data.events.length > MAX_EVENTS)
    data.events.splice(0, data.events.length - MAX_EVENTS);
  data.loaded = true;
  return fresh;
}
/** `get_status` ToolCall result: messages, delegations and user responses. */
export function applyTeam(data: RunData, response: unknown): void {
  const result = rec(rec(response).result);
  data.messages = list(result.messages);
  data.delegations = list(result.delegations);
  data.responses = list(result.user_responses);
}
export function applyExport(data: RunData, report: unknown): void {
  const value = rec(report);
  data.handoffs = list(value.handoffs);
  data.reviews = list(value.reviews);
  data.exportWanted = false;
}

export interface Participant {
  key: string;
  name: string;
  role: string;
  chief: boolean;
  provider: string | null;
  model: string | null;
  native: string | null;
  cli: string | null;
  sessions: Set<string>;
  status: string | null;
  wait: string | null;
  mission: string;
  objective: string;
  criteria: string[];
  dependsOn: string[];
  active: boolean | null;
  task: Rec | null;
}
export interface Team {
  chief: Participant;
  agents: Participant[];
  all: Participant[];
  bySession: Map<string, Participant>;
  byTask: Map<string, Participant>;
}
export function team(data: RunData): Team {
  const run = data.run ?? {};
  const turns = data.activity
    ? data.activity.active.filter((turn) => turn.run_id === data.id)
    : null;
  const chiefSessions = data.sessions.filter((session) => !session.task_id);
  const chief: Participant = {
    key: 'chief',
    name: 'Chef',
    role: 'orchestrateur',
    chief: true,
    provider: str(run.chief_provider),
    model: str(run.chief_model),
    native: str(chiefSessions.at(-1)?.native_session_id),
    cli: str(chiefSessions.at(-1)?.cli_version),
    sessions: new Set(chiefSessions.map((session) => String(session.id))),
    status: str(run.status),
    wait: null,
    mission: str(run.objective) ?? 'Objectif indisponible',
    objective: str(run.objective) ?? '',
    criteria: list(run.acceptance_criteria).map(
      (item) => str(item.description) ?? '',
    ),
    dependsOn: [],
    active: turns ? turns.some((turn) => turn.role === 'chief') : null,
    task: null,
  };
  const counts = new Map<string, number>();
  const agents = data.tasks.map((task): Participant => {
    const spec = rec(task.spec);
    const role = str(spec.role) ?? 'developer';
    const [short, label] = roles[role] ?? [role, role];
    counts.set(short, (counts.get(short) ?? 0) + 1);
    const sessions = data.sessions.filter(
      (session) => session.task_id === task.id,
    );
    const delegation = data.delegations
      .filter((item) => item.task_id === task.id)
      .at(-1);
    return {
      key: String(task.id),
      name: `${short}-${counts.get(short)}`,
      role: label,
      chief: false,
      provider: str(sessions.at(-1)?.provider) ?? str(delegation?.provider),
      model: str(sessions.at(-1)?.model) ?? str(delegation?.model),
      native: str(sessions.at(-1)?.native_session_id),
      cli: str(sessions.at(-1)?.cli_version),
      sessions: new Set(sessions.map((session) => String(session.id))),
      status: str(task.status),
      wait: str(task.wait_reason),
      mission: str(spec.title) ?? String(task.id),
      objective: str(spec.objective) ?? '',
      criteria: list(spec.acceptance_criteria).map(
        (item) => str(item.description) ?? '',
      ),
      dependsOn: Array.isArray(spec.depends_on)
        ? spec.depends_on.map(String)
        : [],
      active: task.status === 'running',
      task,
    };
  });
  const byTask = new Map(agents.map((agent) => [agent.key, agent]));
  for (const agent of agents)
    agent.dependsOn = agent.dependsOn.map((id) => byTask.get(id)?.name ?? id);
  const all = [chief, ...agents];
  const bySession = new Map<string, Participant>();
  for (const person of all)
    for (const session of person.sessions) bySession.set(session, person);
  return { chief, agents, all, bySession, byTask };
}
export function nameOf(crew: Team, id: string | null, kind?: string): string {
  if (!id) return 'inconnu';
  if (id === 'user:local' || kind === 'user') return 'Vous';
  if (kind === 'chief' || id.startsWith('chief')) return 'Chef';
  return crew.bySession.get(id)?.name ?? crew.byTask.get(id)?.name ?? id;
}
export function clock(value: unknown): string {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? '--:--:--'
    : date.toLocaleTimeString('fr-FR', { hour12: false });
}

export type Kind =
  | 'run'
  | 'edit'
  | 'new'
  | 'del'
  | 'read'
  | 'tool'
  | 'ok'
  | 'fail'
  | 'add'
  | 'rem'
  | 'text'
  | 'error'
  | 'perm'
  | 'report'
  | 'block'
  | 'deleg'
  | 'info';
export interface Line {
  kind: Kind;
  text: string;
  at: string | null;
}
const firstLine = (value: string): string =>
  value
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? '';
const parse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
function snippet(kind: 'add' | 'rem', value: unknown, at: string | null) {
  const rows = String(value ?? '').split('\n');
  const shown: Line[] = rows
    .slice(0, 6)
    .map((row) => ({ kind, text: row, at }));
  if (rows.length > 6)
    shown.push({
      kind: 'info',
      text: `… ${rows.length - 6} lignes de plus`,
      at,
    });
  return shown;
}
interface ToolStep {
  id: string | null;
  result?: string;
  lines: Line[];
}
/** Claude emits tool_use/tool_result JSON blocks; Codex emits "type id (status)\ndetail". */
export function toolStep(text: string, at: string | null): ToolStep {
  const block = rec(parse(text));
  if (block.type === 'tool_use') {
    const name = str(block.name) ?? 'outil';
    const input = rec(block.input);
    const path = str(input.file_path) ?? str(input.notebook_path) ?? '';
    const lines: Line[] = [];
    if (name === 'Bash')
      lines.push({ kind: 'run', text: str(input.command) ?? '', at });
    else if (name === 'Edit')
      lines.push(
        { kind: 'edit', text: path, at },
        ...snippet('rem', input.old_string, at),
        ...snippet('add', input.new_string, at),
      );
    else if (name === 'MultiEdit') {
      lines.push({ kind: 'edit', text: path, at });
      for (const edit of list(input.edits).slice(0, 3))
        lines.push(
          ...snippet('rem', edit.old_string, at),
          ...snippet('add', edit.new_string, at),
        );
    } else if (name === 'Write')
      lines.push(
        { kind: 'new', text: path, at },
        ...snippet('add', input.content, at),
      );
    else if (name === 'Read' || name === 'NotebookRead')
      lines.push({ kind: 'read', text: path, at });
    else if (['Grep', 'Glob', 'WebSearch', 'WebFetch'].includes(name))
      lines.push({
        kind: 'read',
        text: `${name} ${str(input.pattern) ?? str(input.query) ?? str(input.url) ?? ''}`,
        at,
      });
    else if (name === 'TodoWrite') {
      const todos = list(input.todos);
      const done = todos.filter((todo) => todo.status === 'completed').length;
      lines.push({
        kind: 'info',
        text: `liste de tâches : ${done} terminées sur ${todos.length}`,
        at,
      });
    } else
      lines.push({
        kind: 'tool',
        text: name.startsWith('mcp__')
          ? `outil ${name.split('__').slice(1).join('.')}`
          : name,
        at,
      });
    return { id: str(block.id), lines };
  }
  if (block.type === 'tool_result') {
    const content =
      typeof block.content === 'string'
        ? block.content
        : list(block.content)
            .map((part) => str(part.text) ?? '')
            .join('\n');
    const failed = block.is_error === true;
    return {
      id: null,
      result: str(block.tool_use_id) ?? '',
      lines: [
        {
          kind: failed ? 'fail' : 'ok',
          text: firstLine(content) || (failed ? 'erreur' : 'terminé'),
          at,
        },
      ],
    };
  }
  const [label = '', ...detail] = text.split('\n');
  const match = /^(\w+) (\S*) \(([^)]*)\)$/.exec(label);
  if (!match) return { id: null, lines: [{ kind: 'tool', text: label, at }] };
  const [, type, id, status] = match;
  const lines: Line[] = [];
  if (type === 'command_execution') {
    lines.push({ kind: 'run', text: detail[0] ?? '', at });
    const code = /^exit_code: (-?\d+)$/.exec(detail[1] ?? '')?.[1];
    if (code !== undefined)
      lines.push({
        kind: code === '0' ? 'ok' : 'fail',
        text: `code ${code}${firstLine(detail.slice(2).join('\n')) ? ' · ' + firstLine(detail.slice(2).join('\n')) : ''}`,
        at,
      });
    else if (status !== 'completed')
      lines.push({ kind: 'info', text: `en cours (${status})`, at });
  } else if (type === 'file_change') {
    for (const change of list(parse(detail.join('\n'))))
      lines.push({
        kind:
          change.kind === 'add'
            ? 'new'
            : change.kind === 'delete'
              ? 'del'
              : 'edit',
        text: `${str(change.path) ?? '?'} (diff non fourni par Codex)`,
        at,
      });
  } else if (type === 'todo_list') {
    const items = list(parse(detail.join('\n')));
    lines.push({
      kind: 'info',
      text: `liste de tâches : ${items.filter((item) => item.completed === true).length} cochées sur ${items.length}`,
      at,
    });
  } else if (type === 'web_search')
    lines.push({ kind: 'read', text: `recherche ${detail[0] ?? ''}`, at });
  else lines.push({ kind: 'tool', text: `outil ${detail[0] ?? type}`, at });
  return { id: `${type}:${id}`, lines };
}
const lookup = (rows: Rec[], id: unknown): Rec | undefined =>
  rows.find((row) => row.id === id);

function involves(person: Participant, event: Rec): boolean {
  const session = str(event.session_id),
    actor = str(event.actor_id);
  if (person.chief)
    return (
      (session !== null && person.sessions.has(session)) ||
      (actor !== null && person.sessions.has(actor)) ||
      (!event.task_id && String(event.type).startsWith('run.'))
    );
  return (
    event.task_id === person.key ||
    (session !== null && person.sessions.has(session)) ||
    (actor !== null && person.sessions.has(actor))
  );
}
/** Observable history of one participant, built only from recorded events. */
export function activity(data: RunData, crew: Team, person: Participant) {
  const steps: ToolStep[] = [];
  const byId = new Map<string, ToolStep>();
  const push = (line: Line) => steps.push({ id: null, lines: [line] });
  for (const event of data.events) {
    if (!involves(person, event)) continue;
    const payload = rec(event.payload);
    const at = str(event.occurred_at);
    const subject = payload.subject_id;
    switch (event.type) {
      case 'provider.tool': {
        const step = toolStep(String(payload.text ?? ''), at);
        if (step.result !== undefined) {
          const owner = byId.get(step.result);
          if (owner) owner.lines.push(...step.lines);
          else steps.push(step);
        } else if (step.id && byId.has(step.id)) {
          byId.get(step.id)!.lines = step.lines;
        } else {
          steps.push(step);
          if (step.id) byId.set(step.id, step);
        }
        break;
      }
      case 'provider.text':
        push({ kind: 'text', text: String(payload.text ?? ''), at });
        break;
      case 'provider.error':
        push({
          kind: 'error',
          text: `${str(rec(payload.error).kind) ?? 'erreur'} : ${str(rec(payload.error).message) ?? 'sans diagnostic'}`,
          at,
        });
        break;
      case 'provider.permission':
        push({
          kind: 'perm',
          text: `permission refusée : ${deniedAction(payload)}`,
          at,
        });
        break;
      case 'provider.result':
        push(
          payload.success === true
            ? { kind: 'ok', text: 'tour terminé (succès déclaré)', at }
            : { kind: 'fail', text: 'tour terminé sans succès', at },
        );
        break;
      case 'provider.session':
        push({
          kind: 'info',
          text: `session native ${str(payload.native_session_id) ?? 'indisponible'}`,
          at,
        });
        break;
      case 'task.created':
        push(
          person.chief
            ? {
                kind: 'deleg',
                text: `mission créée : ${crew.byTask.get(String(event.task_id))?.name ?? event.task_id}`,
                at,
              }
            : { kind: 'deleg', text: 'mission créée par le chef', at },
        );
        break;
      case 'task.delegated': {
        const target = crew.byTask.get(String(event.task_id));
        push({
          kind: 'deleg',
          text: person.chief
            ? `délégation → ${target?.name ?? event.task_id} (${providerLabel(target?.provider ?? null)})`
            : 'délégation enregistrée par le chef',
          at,
        });
        break;
      }
      case 'task.claimed':
        push({ kind: 'info', text: 'tentative démarrée', at });
        break;
      case 'handoff.submitted': {
        const handoff = lookup(data.handoffs, subject);
        push({
          kind: 'report',
          text: handoff
            ? `compte rendu (${handoffStatus(handoff)}) : ${firstLine(String(handoff.summary ?? ''))}`
            : 'compte rendu transmis au chef',
          at,
        });
        break;
      }
      case 'task.blocked': {
        const blocker = lookup(data.blockers, subject);
        push({
          kind: 'block',
          text: `blocage signalé${blocker ? ' : ' + firstLine(String(blocker.reason ?? '')) : ''}`,
          at,
        });
        break;
      }
      case 'task.note_published':
        push({ kind: 'report', text: 'note publiée (contenu non exposé)', at });
        break;
      case 'review.submitted': {
        const review = lookup(data.reviews, subject);
        push({
          kind: 'report',
          text: `revue soumise${review ? ' : ' + reviewOutcome(review) : ''}`,
          at,
        });
        break;
      }
      case 'task.accepted':
        push({ kind: 'ok', text: 'livraison validée par le moteur', at });
        break;
      case 'task.wait_changed':
        push({ kind: 'info', text: 'attente mise à jour', at });
        break;
      case 'task.amended':
        push({ kind: 'deleg', text: 'mission amendée', at });
        break;
      case 'task.revoked':
        push({ kind: 'fail', text: 'tentative révoquée', at });
        break;
      case 'decision.recorded': {
        const decision = lookup(data.decisions, subject);
        push({
          kind: 'deleg',
          text: `décision${decision ? ' : ' + firstLine(String(decision.answer ?? '')) : ' enregistrée'}`,
          at,
        });
        break;
      }
      case 'question.requested':
        push({ kind: 'deleg', text: 'question posée à l’utilisateur', at });
        break;
      case 'message.queued': {
        const message = lookup(data.messages, subject);
        push({
          kind: 'deleg',
          text: message
            ? `message → ${nameOf(crew, str(message.recipient_id), str(message.recipient_kind) ?? undefined)} : ${firstLine(String(message.content ?? ''))}`
            : 'message envoyé',
          at,
        });
        break;
      }
      case 'run.updated':
      case 'run.completed':
        push({
          kind: 'info',
          text: `session : ${stateLabel(str(data.run?.status))}`,
          at,
        });
        break;
    }
  }
  return steps.flatMap((step) => step.lines);
}
export function deniedAction(payload: Rec): string {
  const denials = parse(String(payload.text ?? ''));
  const rows = Array.isArray(denials) ? list(denials) : [rec(denials)];
  const names = rows
    .map((row) => {
      const input = rec(row.tool_input);
      const name = str(row.tool_name);
      const detail = str(input.command) ?? str(input.file_path);
      return name ? `${name}${detail ? ' (' + detail + ')' : ''}` : null;
    })
    .filter(Boolean);
  return names.length
    ? names.join(', ')
    : firstLine(String(payload.text ?? '')) || 'action non précisée';
}
export const handoffStatus = (handoff: Rec): string =>
  handoff.status === 'delivered'
    ? 'livré, déclaré'
    : handoff.status === 'partial'
      ? 'partiel, déclaré'
      : 'bloqué, déclaré';
const reviewOutcome = (review: Rec): string =>
  review.outcome === 'approved'
    ? 'approuvée'
    : review.outcome === 'changes_requested'
      ? 'corrections demandées'
      : 'bloquée';

/** "Terminé", "testé" and "validé" stay distinct: declared, declared checks, engine acceptance. */
export function delivery(data: RunData, person: Participant): Line[] {
  if (person.chief) return [];
  const handoff = data.handoffs
    .filter((item) => item.task_id === person.key)
    .at(-1);
  const submitted = data.events.some(
    (event) =>
      event.type === 'handoff.submitted' && event.task_id === person.key,
  );
  const checks = handoff ? list(handoff.verifications) : [];
  const passed = checks.filter((check) => check.result === 'passed').length;
  const modes = [...new Set(checks.map((check) => String(check.mode)))].join(
    '/',
  );
  const review = data.reviews
    .filter((item) => item.review_of_task_id === person.key)
    .at(-1);
  return [
    handoff
      ? {
          kind: handoff.status === 'delivered' ? 'ok' : 'block',
          text: `terminé : ${handoffStatus(handoff)} — ${firstLine(String(handoff.summary ?? ''))}`,
          at: str(handoff.created_at),
        }
      : {
          kind: 'info',
          text: submitted
            ? 'terminé : compte rendu soumis (détail en lecture)'
            : 'terminé : aucun compte rendu',
          at: null,
        },
    {
      kind: !checks.length ? 'info' : passed === checks.length ? 'ok' : 'fail',
      text: checks.length
        ? `testé : ${passed}/${checks.length} vérifications déclarées réussies (${modes})`
        : 'testé : aucune vérification déclarée',
      at: null,
    },
    {
      kind: person.status === 'accepted' ? 'ok' : 'info',
      text:
        person.status === 'accepted'
          ? 'validé : livraison acceptée par le moteur'
          : `validé : non${review ? ' — revue ' + reviewOutcome(review) : ''}`,
      at: null,
    },
  ];
}

export interface Exchange {
  at: string;
  seq: number;
  from: string;
  to: string;
  fromKey: string | null;
  toKey: string | null;
  text: string;
  status: string;
  tone: Tone;
}
const keyOf = (crew: Team, id: string | null, kind?: string): string | null =>
  !id
    ? null
    : id === 'user:local' || kind === 'user'
      ? 'user'
      : kind === 'chief' || id.startsWith('chief')
        ? 'chief'
        : (crew.bySession.get(id)?.key ?? crew.byTask.get(id)?.key ?? null);
/** Journal entries come from message records and coordination events only. */
export function exchanges(data: RunData, crew: Team): Exchange[] {
  const rows: Exchange[] = data.messages.map((message) => {
    const sender = str(message.sender_id),
      recipient = str(message.recipient_id),
      kind = str(message.recipient_kind) ?? undefined;
    const status = str(message.status) ?? 'queued';
    return {
      at: String(message.created_at ?? ''),
      seq: 0,
      from: nameOf(crew, sender),
      to: nameOf(crew, recipient, kind),
      fromKey: keyOf(crew, sender),
      toKey: keyOf(crew, recipient, kind),
      text: `${messageKinds[String(message.kind)] ?? 'message'} : ${firstLine(String(message.content ?? ''))}`,
      status: messageStatus[status] ?? status,
      tone: status === 'failed' ? 'red' : 'cyan',
    };
  });
  for (const event of data.events) {
    const payload = rec(event.payload);
    const task = crew.byTask.get(String(event.task_id));
    const actor = str(event.actor_id);
    const at = String(event.occurred_at ?? ''),
      seq = Number(event.seq);
    const add = (row: Omit<Exchange, 'at' | 'seq'>) =>
      rows.push({ at, seq, ...row });
    if (event.type === 'task.delegated' && task)
      add({
        from: 'Chef',
        to: task.name,
        fromKey: 'chief',
        toKey: task.key,
        text: `délégation : ${task.mission}`,
        status: 'enregistrée',
        tone: 'cyan',
      });
    else if (event.type === 'handoff.submitted' && task) {
      const handoff = lookup(data.handoffs, payload.subject_id);
      add({
        from: task.name,
        to: 'Chef',
        fromKey: task.key,
        toKey: 'chief',
        text: `compte rendu : ${handoff ? firstLine(String(handoff.summary ?? '')) : 'contenu en lecture'}`,
        status: handoff ? handoffStatus(handoff) : 'enregistré',
        tone: 'green',
      });
    } else if (event.type === 'task.blocked' && task) {
      const blocker = lookup(data.blockers, payload.subject_id);
      add({
        from: task.name,
        to: 'Chef',
        fromKey: task.key,
        toKey: 'chief',
        text: `blocage : ${blocker ? firstLine(String(blocker.reason ?? '')) : 'motif non exposé'}`,
        status: 'enregistré',
        tone: 'red',
      });
    } else if (event.type === 'review.submitted') {
      const review = lookup(data.reviews, payload.subject_id);
      const reviewer = nameOf(crew, actor);
      add({
        from: reviewer,
        to: 'Chef',
        fromKey: keyOf(crew, actor),
        toKey: 'chief',
        text: `revue${review ? ' ' + reviewOutcome(review) : ''}`,
        status: 'enregistrée',
        tone: 'green',
      });
    } else if (event.type === 'question.requested') {
      const question = lookup(data.questions, payload.subject_id);
      add({
        from: 'Chef',
        to: 'Vous',
        fromKey: 'chief',
        toKey: 'user',
        text: `question : ${firstLine(String(question?.question ?? 'contenu non exposé'))}`,
        status: question?.status === 'answered' ? 'répondue' : 'ouverte',
        tone: 'yellow',
      });
    } else if (event.type === 'question.answered')
      add({
        from: 'Vous',
        to: 'Chef',
        fromKey: 'user',
        toKey: 'chief',
        text: 'réponse à une question',
        status: 'enregistrée',
        tone: 'cyan',
      });
    else if (event.type === 'task.accepted' && task)
      add({
        from: nameOf(crew, actor),
        to: task.name,
        fromKey: keyOf(crew, actor),
        toKey: task.key,
        text: 'livraison acceptée',
        status: 'enregistrée',
        tone: 'green',
      });
  }
  return rows.sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq,
  );
}

export interface Entry {
  /** Set on messages sent from this view until the service lists them. */
  id?: string;
  at: string;
  seq: number;
  who: string;
  to: string | null;
  tone: Tone;
  label: string;
  text: string;
}
/** Conversation with the chief: user messages, chief replies, questions, decisions, reports. */
export function conversation(
  data: RunData,
  crew: Team,
  pending: readonly Entry[] = [],
): Entry[] {
  const known = new Set(data.messages.map((message) => String(message.id)));
  const rows = pending.filter((row) => !row.id || !known.has(row.id));
  for (const message of data.messages) {
    const sender = str(message.sender_id),
      kind = str(message.recipient_kind);
    if (sender !== 'user:local' && kind !== 'user') continue;
    const status = str(message.status) ?? 'queued';
    rows.push({
      at: String(message.created_at ?? ''),
      seq: 0,
      who: nameOf(crew, sender),
      to: nameOf(crew, str(message.recipient_id), kind ?? undefined),
      tone: sender === 'user:local' ? 'cyan' : 'avt',
      label: `${messageKinds[String(message.kind)] ?? 'message'} · ${messageStatus[status] ?? status}`,
      text: String(message.content ?? ''),
    });
  }
  for (const event of data.events) {
    const at = String(event.occurred_at ?? ''),
      seq = Number(event.seq);
    const payload = rec(event.payload);
    if (
      event.type === 'provider.text' &&
      crew.chief.sessions.has(String(event.session_id))
    )
      rows.push({
        at,
        seq,
        who: 'Chef',
        to: null,
        tone: 'avt',
        label:
          payload.provenance === 'simulated'
            ? 'réponse (simulation)'
            : 'réponse',
        text: String(payload.text ?? ''),
      });
    else if (event.type === 'handoff.submitted') {
      const handoff = lookup(data.handoffs, payload.subject_id);
      rows.push({
        at,
        seq,
        who: crew.byTask.get(String(event.task_id))?.name ?? 'Agent',
        to: 'Chef',
        tone: 'green',
        label: `compte rendu · ${handoff ? handoffStatus(handoff) : 'enregistré'}`,
        text: handoff
          ? [
              String(handoff.summary ?? ''),
              ...(Array.isArray(handoff.limitations)
                ? handoff.limitations.map(
                    (item) => '⚠ limite : ' + String(item),
                  )
                : []),
            ].join('\n')
          : 'Contenu en lecture (export du run).',
      });
    } else if (event.type === 'task.blocked') {
      const blocker = lookup(data.blockers, payload.subject_id);
      rows.push({
        at,
        seq,
        who: crew.byTask.get(String(event.task_id))?.name ?? 'Agent',
        to: 'Chef',
        tone: 'red',
        label: 'blocage',
        text: String(blocker?.reason ?? 'Motif non exposé.'),
      });
    }
  }
  for (const question of data.questions) {
    const response = data.responses.find(
      (item) => item.question_id === question.id,
    );
    rows.push({
      at: String(question.created_at ?? ''),
      seq: 0,
      who: 'Chef',
      to: 'Vous',
      tone: 'yellow',
      label: `question ${question.blocking ? 'bloquante' : 'non bloquante'} · ${question.status === 'answered' ? 'répondue' : 'ouverte'} · ${str(question.id) ?? ''}`,
      text: [
        String(question.question ?? ''),
        ...list(question.options).map(
          (option, index) =>
            `${index + 1}. ${str(option.label) ?? ''} — ${str(option.consequence) ?? ''}`,
        ),
      ].join('\n'),
    });
    if (response)
      rows.push({
        at: String(response.created_at ?? ''),
        seq: 0,
        who: 'Vous',
        to: 'Chef',
        tone: 'cyan',
        label: 'réponse enregistrée',
        text: String(response.answer ?? ''),
      });
  }
  for (const decision of data.decisions)
    rows.push({
      at: String(decision.created_at ?? ''),
      seq: 0,
      who: 'Chef',
      to: null,
      tone: decision.status === 'approved' ? 'green' : 'yellow',
      label: `décision · ${decision.status === 'approved' ? 'approuvée' : (str(decision.status) ?? '')}`,
      text: `${String(decision.question ?? '')}\n→ ${String(decision.answer ?? '')}`,
    });
  return rows.sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq,
  );
}

/** Factual counts, never a percentage. */
export function taskCounts(data: RunData): string {
  const count = (statuses: string[]) =>
    data.tasks.filter((task) => statuses.includes(String(task.status))).length;
  if (!data.tasks.length) return 'aucune tâche créée';
  return [
    `${count(['accepted'])} acceptée(s)`,
    `${count(['running', 'in_review', 'validating'])} en cours/revue`,
    `${count(['planned', 'ready', 'waiting_dependency', 'waiting_user', 'waiting_provider', 'changes_requested'])} en attente`,
    `${count(['blocked', 'failed'])} bloquée(s)/échec`,
    `${data.tasks.length} au total`,
  ].join(' · ');
}
export function usage(data: RunData, person: Participant): string | null {
  const event = data.events
    .filter(
      (item) =>
        item.type === 'provider.usage' &&
        person.sessions.has(String(item.session_id)),
    )
    .at(-1);
  const payload = rec(event?.payload);
  const value = rec(payload.usage);
  if (payload.provenance !== 'live') return null;
  if (
    typeof value.input_tokens !== 'number' &&
    typeof value.output_tokens !== 'number'
  )
    return null;
  return `usage déclaré du dernier tour : entrée ${str(value.input_tokens) ?? '?'} · sortie ${str(value.output_tokens) ?? '?'}`;
}

export interface Alert {
  key: string;
  kind: 'question' | 'permission';
  title: string;
  requester: string;
  action: string;
  scope: string;
  choices: string[];
  note: string;
  question: Rec | null;
}
export function alerts(
  data: RunData,
  crew: Team,
  dismissed: ReadonlySet<string>,
): Alert[] {
  const rows: Alert[] = data.questions
    .filter((question) => question.status === 'open')
    .sort((a, b) => Number(b.blocking === true) - Number(a.blocking === true))
    .map((question) => {
      const affected = Array.isArray(question.affects_task_ids)
        ? question.affects_task_ids.map(
            (id) => crew.byTask.get(String(id))?.name ?? String(id),
          )
        : [];
      return {
        key: `question:${String(question.id)}`,
        kind: 'question',
        title: question.blocking
          ? 'Question bloquante du chef'
          : 'Question du chef',
        requester: nameOf(crew, str(question.requested_by)),
        action: String(question.question ?? ''),
        scope: affected.length
          ? `tâches ${affected.join(', ')}`
          : 'session entière',
        choices: list(question.options).map(
          (option, index) => `${index + 1} ${str(option.label) ?? ''}`,
        ),
        note: list(question.options).length
          ? 'Options proposées par le chef ou réponse libre ; la réponse est liée à cette question.'
          : 'Réponse libre liée à cette question.',
        question,
      };
    });
  for (const event of data.events) {
    if (event.type !== 'provider.permission') continue;
    const key = `permission:${String(event.seq)}`;
    if (dismissed.has(key)) continue;
    const who =
      crew.bySession.get(String(event.session_id)) ??
      crew.byTask.get(String(event.task_id)) ??
      crew.chief;
    rows.push({
      key,
      kind: 'permission',
      title: 'Permission refusée par le fournisseur',
      requester: `${who.name} (${providerLabel(who.provider)})`,
      action: deniedAction(rec(event.payload)),
      scope: who.chief ? 'tour du chef' : `tâche ${who.mission}`,
      choices: [],
      note: `Refus déjà appliqué par la CLI native ; Avity Crew n’expose aucune approbation interactive. Profil : ${str(rec(rec(data.project.config).permissions).profile) ?? 'indisponible'}.`,
      question: null,
    });
  }
  return rows;
}

export interface Command {
  name: string;
  usage: string;
  label: string;
  target: string;
  effect: string;
  value: string;
  disabled: string | null;
}
/** Palette entries describe real engine capabilities; unsupported ones stay visible but disabled. */
export function commands(
  data: RunData | null,
  doctor: Rec | null,
  view: string,
): Command[] {
  const run = data?.run ?? null;
  const live =
    run && !['completed', 'failed', 'cancelled'].includes(String(run.status));
  const permissions = rec(rec(data?.project.config).permissions);
  const unavailable = (provider: string) =>
    list(doctor?.providers).some(
      (item) => item.provider === provider && item.status !== 'available',
    );
  const noRun = 'Aucune session ouverte : utiliser /new.';
  const ended = 'Session terminée : réglage sans effet.';
  return [
    {
      name: 'provider',
      usage: '/provider claude|codex',
      label: 'Fournisseur du chef',
      target: 'Chef de la session',
      effect:
        'Immédiat : remplace le chef (nouvelle génération, mémoire non transférée)',
      value: run
        ? providerLabel(str(run.chief_provider))
        : 'formulaire de nouvelle session',
      disabled: !run ? noRun : !live ? ended : null,
    },
    {
      name: 'model',
      usage: '/model <identifiant>|défaut',
      label: 'Modèle du chef',
      target: 'Chef de la session',
      effect: 'Immédiat : remplace le chef avec ce modèle, même fournisseur',
      value: run ? (str(run.chief_model) ?? 'défaut de la configuration') : '—',
      disabled: !run ? noRun : !live ? ended : null,
    },
    {
      name: 'effort',
      usage: '/effort',
      label: 'Puissance (effort de raisonnement)',
      target: 'Chef et agents',
      effect: '—',
      value: 'indisponible',
      disabled:
        'Non pris en charge : le moteur ne transmet aucun réglage d’effort à Claude Code ni à Codex.',
    },
    {
      name: 'permissions',
      usage: '/permissions',
      label: 'Permissions des sessions natives',
      target: 'Projet (service)',
      effect: 'Lecture seule ici ; relu au redémarrage du service',
      value: data
        ? `${str(permissions.profile) ?? 'indisponible'} · production ${permissions.allow_production ? 'autorisée' : 'interdite'} · publication externe ${permissions.allow_external_publication ? 'autorisée' : 'interdite'}`
        : 'indisponible',
      disabled:
        'Modification non exposée par le moteur : éditer la configuration du projet puis redémarrer le service.',
    },
    {
      name: 'sessions',
      usage: '/sessions',
      label: 'Sessions (objectifs)',
      target: 'Interface',
      effect: 'Ouvre la liste des sessions',
      value: '',
      disabled: null,
    },
    {
      name: 'agents',
      usage: '/agents',
      label: 'Inspecter l’équipe',
      target: 'Session',
      effect: 'Fournisseurs, sessions natives et états',
      value: data ? `${data.tasks.length} agent(s)` : '',
      disabled: data ? null : noRun,
    },
    {
      name: 'view',
      usage: '/view activité|carte|conversation',
      label: 'Vue principale',
      target: 'Interface',
      effect: 'Immédiat',
      value: view,
      disabled: null,
    },
    {
      name: 'to',
      usage: '/to chef|<agent>',
      label: 'Destinataire de la saisie',
      target: 'Message suivant',
      effect: 'Immédiat (Ctrl+T fait défiler)',
      value: '',
      disabled: data ? null : noRun,
    },
    {
      name: 'new',
      usage: '/new',
      label: 'Nouvelle session',
      target: 'Projet',
      effect: 'Formulaire objectif, critères, chef',
      value: '',
      disabled: null,
    },
    {
      name: 'pause',
      usage: '/pause',
      label: 'Mettre la session en pause',
      target: 'Session',
      effect: 'Interrompt les tours, reprise possible',
      value: run ? stateLabel(str(run.status)) : '',
      disabled: !run ? noRun : !live ? ended : null,
    },
    {
      name: 'resume',
      usage: '/resume',
      label: 'Reprendre la session',
      target: 'Session',
      effect: 'Réconcilie puis relance',
      value: '',
      disabled: !run ? noRun : !live ? ended : null,
    },
    {
      name: 'stop',
      usage: '/stop',
      label: 'Arrêter la session',
      target: 'Session',
      effect: 'Définitif : annule, non reprenable',
      value: '',
      disabled: !run ? noRun : !live ? ended : null,
    },
    {
      name: 'reassign',
      usage: '/reassign',
      label: 'Réattribuer la tâche sélectionnée',
      target: 'Agent sélectionné',
      effect: 'Nécessite une tentative arrêtée ou réconciliée',
      value: '',
      disabled: !run ? noRun : !live ? ended : null,
    },
    {
      name: 'answer',
      usage: '/answer <question:ID> <texte>',
      label: 'Répondre à une question',
      target: 'Question du chef',
      effect: 'Réponse liée à la question',
      value: data
        ? `${data.questions.filter((question) => question.status === 'open').length} ouverte(s)`
        : '',
      disabled: data ? null : noRun,
    },
    {
      name: 'compose',
      usage: '/compose',
      label: 'Saisie multiligne',
      target: 'Saisie',
      effect: 'Native : Alt+Entrée ou Ctrl+J insère une ligne',
      value: '',
      disabled: null,
    },
    {
      name: 'cancel',
      usage: '/cancel',
      label: 'Effacer le brouillon',
      target: 'Saisie',
      effect: 'Immédiat',
      value: '',
      disabled: null,
    },
    {
      name: 'help',
      usage: '/help',
      label: 'Aide et raccourcis',
      target: 'Interface',
      effect: '',
      value: '',
      disabled: null,
    },
    {
      name: 'quit',
      usage: '/quit',
      label: 'Détacher l’interface',
      target: 'Interface',
      effect: 'Le service et les agents continuent',
      value: '',
      disabled: null,
    },
  ].map((command) =>
    command.name === 'provider' &&
    !command.disabled &&
    unavailable('claude') &&
    unavailable('codex')
      ? { ...command, disabled: 'Aucun fournisseur disponible selon doctor.' }
      : command,
  );
}

export interface PaletteItem extends Command {
  insert: string;
  arg: string | null;
}
export const needsArgument = ['provider', 'model', 'view', 'to', 'answer'];
/** Filters commands, then offers real choices for the command's argument. */
export function paletteItems(
  draft: string,
  data: RunData | null,
  doctor: Rec | null,
  view: string,
): PaletteItem[] {
  const match = /^\/(\S*)(\s+[\s\S]*)?$/.exec(draft);
  if (!match) return [];
  const word = (match[1] ?? '').toLowerCase();
  const all = commands(data, doctor, view);
  const exact = all.find((command) => command.name === word);
  if (exact && match[2] !== undefined) {
    const arg = match[2].trim();
    const choose = (choices: [string, string, string | null][]) =>
      choices
        .filter(([value]) => !arg || value.startsWith(arg.toLowerCase()))
        .map(([value, label, disabled]) => ({
          ...exact,
          insert: `/${exact.name} ${value}`,
          label,
          value: '',
          arg: value,
          disabled: exact.disabled ?? disabled,
        }));
    if (exact.name === 'provider') {
      const current = str(data?.run?.chief_provider);
      return choose(
        ['claude', 'codex'].map((provider) => {
          const probe = list(doctor?.providers).find(
            (item) => item.provider === provider,
          );
          return [
            provider,
            `${providerLabel(provider)}${provider === current ? ' (actuel)' : ''}`,
            probe && probe.status !== 'available'
              ? `${providerLabel(provider)} indisponible selon doctor : ${str(probe.message) ?? 'sonde en échec'}`
              : null,
          ];
        }),
      );
    }
    if (exact.name === 'view')
      return choose([
        ['activité', 'Activité : chef et mosaïque des agents', null],
        ['carte', 'Carte : orchestrateur, agents et échanges', null],
        ['conversation', 'Conversation avec le chef', null],
      ]);
    if (exact.name === 'to')
      return choose([
        ['chef', 'Chef de la session', null],
        ...(data ? team(data).agents : []).map(
          (agent): [string, string, string | null] => [
            agent.name,
            `${agent.name} · ${agent.role} · ${agent.mission}`,
            null,
          ],
        ),
      ]);
    return [
      {
        ...exact,
        insert: `/${exact.name} ${arg}`,
        arg: arg || null,
      },
    ];
  }
  return all
    .filter(
      (command) =>
        command.name.startsWith(word) ||
        (word.length > 1 && command.label.toLowerCase().includes(word)),
    )
    .map((command) => ({ ...command, insert: `/${command.name}`, arg: null }));
}
