import { emitKeypressEvents } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { CrewError, ident } from '../../../../packages/contracts/src/index.ts';
import type { ToolCall } from '../../../../packages/contracts/src/index.ts';
import type { SupervisorClient } from '../../../../packages/supervisor/src/client.ts';
import { MAX_JSON_BYTES } from '../../../../packages/supervisor/src/protocol.ts';
import { parseCli, runArguments } from '../args.ts';
import { sendMessage } from '../service.ts';
import { cleanText, runExit } from '../view.ts';
import {
  alerts,
  applyExport,
  applyStatus,
  applyTeam,
  commands,
  emptyRun,
  list,
  needsArgument,
  paletteItems,
  providerLabel,
  rec,
  str,
  team,
} from './model.ts';
import type { Entry, Rec, RunData } from './model.ts';
import { formFields, renderFrame, viewLabel } from './render.ts';
import { Screen, graphemes } from './term.ts';
import type { Tone } from './term.ts';

export interface Draft {
  text: string;
  cursor: number;
}
type TextField = 'objective' | 'criteria' | 'constraints' | 'model' | 'agents';
export interface FormState {
  field: number;
  values: Record<TextField, Draft>;
  chief: number;
  mode: number;
  error: string | null;
  busy: boolean;
}
export type ViewName = 'activite' | 'carte' | 'conversation';
export interface State {
  projectRoot: string;
  width: number;
  height: number;
  now: number;
  view: ViewName;
  overlay: null | 'help' | 'sessions' | 'agents';
  sidebar: boolean;
  runs: Rec[];
  current: string | null;
  form: FormState | null;
  data: Map<string, RunData>;
  /** Drafts are keyed by session ('new' before any session): switching never loses text. */
  drafts: Map<string, Draft>;
  select: Map<string, number>;
  expanded: Map<string, string | null>;
  mosaicTop: Map<string, number>;
  scroll: Map<string, number>;
  counts: Map<string, number>;
  target: Map<string, string>;
  pending: Map<string, Entry[]>;
  paletteIndex: number;
  sessionsIndex: number;
  agentsIndex: number;
  confirm: { text: string; run: () => Promise<void> } | null;
  notice: { text: string; tone: Tone; until: number } | null;
  connection: 'connecté' | 'reconnexion' | 'chargement';
  doctor: Rec | null;
  dismissed: Set<string>;
  pasting: boolean;
}
const blank = (): Draft => ({ text: '', cursor: 0 });
export function newForm(): FormState {
  return {
    field: 0,
    values: {
      objective: blank(),
      criteria: blank(),
      constraints: blank(),
      model: blank(),
      agents: blank(),
    },
    chief: 0,
    mode: 0,
    error: null,
    busy: false,
  };
}
export function createState(
  projectRoot: string,
  current: string | null,
): State {
  return {
    projectRoot,
    width: 120,
    height: 40,
    now: Date.now(),
    view: 'activite',
    overlay: null,
    sidebar: true,
    runs: [],
    current,
    form: null,
    data: new Map(current ? [[current, emptyRun(current)]] : []),
    drafts: new Map(),
    select: new Map(),
    expanded: new Map(),
    mosaicTop: new Map(),
    scroll: new Map(),
    counts: new Map(),
    target: new Map(),
    pending: new Map(),
    paletteIndex: 0,
    sessionsIndex: 0,
    agentsIndex: 0,
    confirm: null,
    notice: null,
    connection: 'chargement',
    doctor: null,
    dismissed: new Set(),
    pasting: false,
  };
}

/** Grapheme-safe editing of the multiline draft. */
function bounds(text: string): number[] {
  const marks = [0];
  for (const part of graphemes(text)) marks.push(marks.at(-1)! + part.length);
  return marks;
}
export function insert(draft: Draft, value: string): void {
  draft.text =
    draft.text.slice(0, draft.cursor) + value + draft.text.slice(draft.cursor);
  draft.cursor += value.length;
}
export function erase(draft: Draft, direction: -1 | 1): void {
  const marks = bounds(draft.text);
  const index = marks.indexOf(draft.cursor);
  const other = marks[index + direction];
  if (index < 0 || other === undefined) return;
  const [from, to] =
    direction < 0 ? [other, draft.cursor] : [draft.cursor, other];
  draft.text = draft.text.slice(0, from) + draft.text.slice(to);
  draft.cursor = from;
}
export function move(draft: Draft, direction: -1 | 1): void {
  const marks = bounds(draft.text);
  const other = marks[marks.indexOf(draft.cursor) + direction];
  if (other !== undefined) draft.cursor = other;
}
export function edge(draft: Draft, end: boolean): void {
  if (end) {
    const next = draft.text.indexOf('\n', draft.cursor);
    draft.cursor = next < 0 ? draft.text.length : next;
  } else draft.cursor = draft.text.lastIndexOf('\n', draft.cursor - 1) + 1;
}
/** Moves between logical lines; false when there is no line in that direction. */
export function vertical(draft: Draft, direction: -1 | 1): boolean {
  const start = draft.text.lastIndexOf('\n', draft.cursor - 1) + 1;
  const column = graphemes(draft.text.slice(start, draft.cursor)).length;
  let target: number;
  if (direction < 0) {
    if (start === 0) return false;
    target = draft.text.lastIndexOf('\n', start - 2) + 1;
  } else {
    const next = draft.text.indexOf('\n', draft.cursor);
    if (next < 0) return false;
    target = next + 1;
  }
  const lineEnd = draft.text.indexOf('\n', target);
  const row = graphemes(
    draft.text.slice(target, lineEnd < 0 ? undefined : lineEnd),
  );
  draft.cursor = target + row.slice(0, column).join('').length;
  return true;
}
function cut(draft: Draft, end: boolean): void {
  const at = draft.cursor;
  edge(draft, end);
  const [from, to] = end ? [at, draft.cursor] : [draft.cursor, at];
  draft.text = draft.text.slice(0, from) + draft.text.slice(to);
  draft.cursor = from;
}

export interface Key {
  name?: string | undefined;
  ctrl?: boolean | undefined;
  meta?: boolean | undefined;
  shift?: boolean | undefined;
  sequence?: string | undefined;
}
export interface Io {
  admin(method: string, args: Record<string, unknown>): Promise<unknown>;
  execute(call: ToolCall): Promise<unknown>;
  send(runId: string, content: string, to: string): Promise<unknown>;
}
const printable = (text: string | undefined, key: Key): text is string =>
  Boolean(text) &&
  !key.ctrl &&
  !key.meta &&
  !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text!);
const failure = (error: unknown): string =>
  error instanceof CrewError
    ? `${error.code} : ${cleanText(error.message)}`
    : 'Action non exécutée ; état du service inchangé ou inconnu.';
const PAGE = 500;

/** Keyboard, actions and polling. The engine stays the only source of truth. */
export class Controller {
  exitCode: number | null = null;
  private lastRuns = 0;
  private lastExport = 0;
  private doctorAsked = false;
  private initial: boolean;
  constructor(
    readonly state: State,
    private readonly io: Io,
    private readonly changed: () => void = () => {},
    home = false,
  ) {
    this.initial = !state.current && !home;
    if (!state.current && home) state.form = newForm();
  }

  private get data(): RunData | null {
    return this.state.current
      ? (this.state.data.get(this.state.current) ?? null)
      : null;
  }
  draft(): Draft {
    const key = this.state.current ?? 'new';
    let draft = this.state.drafts.get(key);
    if (!draft) this.state.drafts.set(key, (draft = blank()));
    return draft;
  }
  notify(text: string, tone: Tone = 'text', seconds = 8): void {
    this.state.notice = { text, tone, until: Date.now() + seconds * 1000 };
    this.changed();
  }
  private mainWidth(): number {
    return (
      this.state.width -
      (this.state.width >= 110 && this.state.sidebar ? 30 : 0)
    );
  }

  open(runId: string | null): void {
    const s = this.state;
    s.current = runId;
    s.overlay = null;
    s.form = null;
    s.paletteIndex = 0;
    if (runId && !s.data.has(runId)) s.data.set(runId, emptyRun(runId));
    this.changed();
  }
  openForm(): void {
    this.state.form ??= newForm();
    this.state.overlay = null;
    this.changed();
  }
  private cycleSession(direction: -1 | 1): void {
    const ids = this.state.runs.map((run) => String(run.id));
    if (!ids.length)
      return this.notify(
        'Aucune session enregistrée pour ce projet.',
        'yellow',
      );
    const index = this.state.current ? ids.indexOf(this.state.current) : -1;
    this.open(ids[(index + direction + ids.length) % ids.length] ?? null);
  }
  private cycleTarget(): void {
    const data = this.data;
    if (!data?.run) return;
    const crew = team(data);
    const options = ['chief'];
    const selected = crew.all[this.state.select.get(data.id) ?? 0];
    if (selected && !selected.chief) options.push(selected.key);
    for (const alert of alerts(data, crew, this.state.dismissed))
      if (alert.kind === 'question') options.push(alert.key);
    const current = this.state.target.get(data.id) ?? 'chief';
    this.state.target.set(
      data.id,
      options[(options.indexOf(current) + 1) % options.length]!,
    );
  }

  async key(text: string | undefined, key: Key): Promise<void> {
    const s = this.state;
    s.now = Date.now();
    if (key.name === 'paste-start') return void (s.pasting = true);
    if (key.name === 'paste-end') return void (s.pasting = false);
    if (key.ctrl && key.name === 'c') return void (this.exitCode = 130);
    if (s.confirm) {
      if (key.name === 'return') {
        const action = s.confirm.run;
        s.confirm = null;
        await action();
      } else if (key.name === 'escape') {
        s.confirm = null;
        this.notify('Action annulée ; rien n’a été envoyé.', 'dim');
      }
      return;
    }
    if (s.form) return this.formKey(text, key);
    const draft = this.draft();
    if (s.pasting) {
      if (key.name === 'return' || key.name === 'enter') insert(draft, '\n');
      else if (key.name === 'tab') insert(draft, '  ');
      else if (printable(text, key)) insert(draft, text);
      return;
    }
    if (key.ctrl && key.name === 'b') {
      if (s.width >= 110) s.sidebar = !s.sidebar;
      else this.showSessions();
      return;
    }
    if (key.ctrl && (key.name === 'p' || key.name === 'n'))
      return this.cycleSession(key.name === 'p' ? -1 : 1);
    if (key.ctrl && key.name === 't') return this.cycleTarget();
    if (key.ctrl && key.name === 'u') return cut(draft, false);
    if (key.ctrl && key.name === 'k') return cut(draft, true);
    if (key.ctrl && key.name === 'a') return edge(draft, false);
    if (key.ctrl && key.name === 'e') return edge(draft, true);
    if (s.overlay) return this.overlayKey(key);
    if (draft.text.startsWith('/') && !draft.text.includes('\n')) {
      const items = paletteItems(
        draft.text,
        this.data,
        s.doctor,
        viewLabel(s.view),
      );
      if (key.name === 'up' || key.name === 'down') {
        s.paletteIndex = Math.max(
          0,
          Math.min(
            items.length - 1,
            s.paletteIndex + (key.name === 'up' ? -1 : 1),
          ),
        );
        return;
      }
      if (key.name === 'escape') {
        draft.text = '';
        draft.cursor = 0;
        return;
      }
      const item = items[Math.min(s.paletteIndex, items.length - 1)];
      if (key.name === 'tab' && item) {
        draft.text =
          item.insert +
          (needsArgument.includes(item.name) && !item.arg ? ' ' : '');
        draft.cursor = draft.text.length;
        s.paletteIndex = 0;
        return;
      }
      if (key.name === 'return' && !key.meta && item) {
        if (item.disabled)
          return this.notify(
            `⊘ /${item.name} : ${item.disabled}`,
            'yellow',
            10,
          );
        if (needsArgument.includes(item.name) && !item.arg) {
          draft.text = item.insert + ' ';
          draft.cursor = draft.text.length;
          s.paletteIndex = 0;
          return;
        }
        draft.text = '';
        draft.cursor = 0;
        s.paletteIndex = 0;
        return this.command(item.insert);
      }
    }
    const data = this.data;
    const crew = data?.run ? team(data) : null;
    const selected = data ? (s.select.get(data.id) ?? 0) : 0;
    const expanded = data ? s.expanded.get(data.id) : null;
    const scope = data
      ? expanded
        ? `${data.id}:detail:${expanded}`
        : s.view === 'carte'
          ? `${data.id}:journal`
          : s.view === 'conversation'
            ? `${data.id}:conversation`
            : null
      : null;
    const scroll = (delta: number) => {
      if (scope)
        s.scroll.set(scope, Math.max(0, (s.scroll.get(scope) ?? 0) + delta));
    };
    const choose = (index: number) => {
      if (data && crew)
        s.select.set(
          data.id,
          Math.max(0, Math.min(crew.all.length - 1, index)),
        );
    };
    const empty = draft.text === '';
    const page = Math.max(3, s.height - 12);
    switch (key.name) {
      case 'tab': {
        const order: ViewName[] = ['activite', 'carte', 'conversation'];
        s.view = order[(order.indexOf(s.view) + (key.shift ? 2 : 1)) % 3]!;
        if (data) s.expanded.set(data.id, null);
        return;
      }
      case 'escape':
        if (data && expanded) s.expanded.set(data.id, null);
        else if (
          data &&
          s.target.get(data.id) &&
          s.target.get(data.id) !== 'chief' &&
          empty
        )
          s.target.set(data.id, 'chief');
        else if (data && crew && empty) {
          const alert = alerts(data, crew, s.dismissed).find(
            (item) => item.kind === 'permission',
          );
          if (alert) s.dismissed.add(alert.key);
        }
        return;
      case 'return':
        if (key.meta) return insert(draft, '\n');
        if (!empty) return this.submit();
        if (data && crew && s.view !== 'conversation')
          s.expanded.set(
            data.id,
            expanded ? null : (crew.all[selected]?.key ?? null),
          );
        return;
      case 'enter':
        return insert(draft, '\n');
      case 'backspace':
        return erase(draft, -1);
      case 'delete':
        return erase(draft, 1);
      case 'pageup':
      case 'pagedown':
        if (scope) scroll(key.name === 'pageup' ? page : -page);
        else choose(selected + (key.name === 'pageup' ? -4 : 4));
        return;
      case 'home':
      case 'end':
        if (!empty) return edge(draft, key.name === 'end');
        if (scope)
          s.scroll.set(
            scope,
            key.name === 'home' ? Number.MAX_SAFE_INTEGER : 0,
          );
        return;
      case 'left':
      case 'right': {
        const direction = key.name === 'left' ? -1 : 1;
        if (!empty) return move(draft, direction);
        if (!expanded) choose(selected + direction);
        return;
      }
      case 'up':
      case 'down': {
        const direction = key.name === 'up' ? -1 : 1;
        if (!empty) return void vertical(draft, direction);
        if (scope && (expanded || s.view === 'conversation'))
          return scroll(-direction);
        if (s.view === 'activite' && crew) {
          const cols = this.mainWidth() >= 96 ? 2 : 1;
          if (direction < 0) choose(selected <= cols ? 0 : selected - cols);
          else choose(selected === 0 ? 1 : selected + cols);
        } else choose(selected + direction);
        return;
      }
    }
    if (!printable(text, key)) return;
    const target = data ? s.target.get(data.id) : undefined;
    if (
      empty &&
      /^[1-9]$/.test(text) &&
      target?.startsWith('question:') &&
      data &&
      crew
    ) {
      const question = alerts(data, crew, s.dismissed).find(
        (alert) => alert.key === target,
      )?.question;
      const option = list(question?.options)[Number(text) - 1];
      if (option) {
        insert(draft, str(option.label) ?? '');
        return;
      }
    }
    if (empty && text === '/') s.paletteIndex = 0;
    insert(draft, text.replaceAll('\t', '  '));
  }

  private showSessions(): void {
    const s = this.state;
    s.overlay = 'sessions';
    s.sessionsIndex = Math.max(
      0,
      s.runs.findIndex((run) => run.id === s.current) + 1,
    );
  }
  private overlayKey(key: Key): void {
    const s = this.state;
    if (
      key.name === 'escape' ||
      (s.overlay === 'help' && key.name === 'return')
    ) {
      s.overlay = null;
      return;
    }
    if (s.overlay === 'sessions') {
      if (key.name === 'up' || key.name === 'down')
        s.sessionsIndex = Math.max(
          0,
          Math.min(
            s.runs.length,
            s.sessionsIndex + (key.name === 'up' ? -1 : 1),
          ),
        );
      else if (key.name === 'return') {
        if (s.sessionsIndex === 0) this.openForm();
        else this.open(String(s.runs[s.sessionsIndex - 1]?.id ?? '') || null);
      }
    } else if (s.overlay === 'agents' && this.data?.run) {
      const crew = team(this.data);
      if (key.name === 'up' || key.name === 'down')
        s.agentsIndex = Math.max(
          0,
          Math.min(
            crew.all.length - 1,
            s.agentsIndex + (key.name === 'up' ? -1 : 1),
          ),
        );
      else if (key.name === 'return') {
        s.select.set(this.data.id, s.agentsIndex);
        s.expanded.set(this.data.id, crew.all[s.agentsIndex]?.key ?? null);
        s.view = 'activite';
        s.overlay = null;
      }
    }
  }

  private async formKey(text: string | undefined, key: Key): Promise<void> {
    const s = this.state;
    const f = s.form!;
    if (f.busy) return;
    const [id] = formFields[f.field]!;
    const field =
      id === 'chief' || id === 'mode' || id === 'submit' ? null : f.values[id];
    const multiline =
      id === 'objective' || id === 'criteria' || id === 'constraints';
    if (s.pasting) {
      if (!field) return;
      if (key.name === 'return' || key.name === 'enter')
        insert(field, multiline ? '\n' : ' ');
      else if (printable(text, key)) insert(field, text);
      return;
    }
    const step = (direction: number) => {
      f.field = (f.field + direction + formFields.length) % formFields.length;
    };
    if (key.name === 'escape') {
      if (s.current || s.runs.length) {
        s.form = null;
        if (!s.current) this.showSessions();
      } else
        this.notify(
          'Créez une première session ou détachez avec Ctrl+C.',
          'yellow',
        );
      return;
    }
    if (key.name === 'tab') return step(key.shift ? -1 : 1);
    if (key.name === 'return' && !key.meta) {
      if (id === 'submit') return this.submitForm();
      return step(1);
    }
    if (
      (key.name === 'enter' || (key.name === 'return' && key.meta)) &&
      field &&
      multiline
    )
      return insert(field, '\n');
    if (key.name === 'left' || key.name === 'right') {
      const direction = key.name === 'left' ? -1 : 1;
      if (id === 'chief') f.chief = (f.chief + direction + 3) % 3;
      else if (id === 'mode') f.mode = (f.mode + direction + 2) % 2;
      else if (field) move(field, direction);
      return;
    }
    if (key.name === 'up' || key.name === 'down') {
      const direction = key.name === 'up' ? -1 : 1;
      if (!field || !vertical(field, direction)) step(direction);
      return;
    }
    if (!field) return;
    if (key.name === 'backspace') return erase(field, -1);
    if (key.name === 'delete') return erase(field, 1);
    if (key.name === 'home' || (key.ctrl && key.name === 'a'))
      return edge(field, false);
    if (key.name === 'end' || (key.ctrl && key.name === 'e'))
      return edge(field, true);
    if (key.ctrl && key.name === 'u') return cut(field, false);
    if (key.ctrl && key.name === 'k') return cut(field, true);
    if (printable(text, key)) insert(field, text.replaceAll('\t', '  '));
  }

  /** Reuses the CLI parser so the form accepts exactly what `run` accepts. */
  private async submitForm(): Promise<void> {
    const f = this.state.form!;
    const lines = (draft: Draft) =>
      draft.text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const objective = f.values.objective.text;
    if (!objective.trim()) {
      f.error = 'Objectif requis.';
      f.field = 0;
      return;
    }
    if (!lines(f.values.criteria).length) {
      f.error = 'Au moins un critère observable est requis.';
      f.field = 1;
      return;
    }
    if (Buffer.byteLength(objective) > MAX_JSON_BYTES) {
      f.error = 'Objectif supérieur à 1 MiB.';
      return;
    }
    let args: Record<string, unknown>;
    try {
      const model = f.values.model.text.trim(),
        agents = f.values.agents.text.trim();
      args = runArguments(
        parseCli([
          'run',
          ...lines(f.values.criteria).flatMap((item) => ['--criterion', item]),
          ...lines(f.values.constraints).flatMap((item) => [
            '--constraint',
            item,
          ]),
          ...(f.chief ? ['--chief', f.chief === 1 ? 'claude' : 'codex'] : []),
          ...(model ? ['--model', model] : []),
          ...(agents ? ['--max-agents', agents] : []),
          '--mode',
          f.mode ? 'documentation' : 'code',
          '--',
          objective,
        ]),
        objective,
      );
    } catch (error) {
      f.error = failure(error);
      return;
    }
    f.busy = true;
    f.error = null;
    this.changed();
    try {
      const run = rec(await this.io.admin('create_run', args));
      const id = str(run.id);
      if (!id)
        throw new CrewError(
          'TRANSPORT_PROTOCOL_ERROR',
          'Objectif enregistré sans identité lisible ; consulter status avant toute nouvelle demande.',
        );
      this.state.runs = [
        run,
        ...this.state.runs.filter((item) => item.id !== id),
      ];
      this.state.drafts.delete('new');
      this.open(id);
      this.notify(
        `Session ${id} enregistrée ; le chef démarre. Rien n’est encore vérifié.`,
        'green',
        10,
      );
    } catch (error) {
      f.error =
        error instanceof CrewError &&
        error.code === 'GIT_INITIALIZATION_REQUIRED'
          ? 'Ce dossier n’a pas de révision Git : utiliser le mode documentation ou `avity-crew run --init-git`.'
          : failure(error);
    } finally {
      f.busy = false;
    }
  }

  private async submit(): Promise<void> {
    const s = this.state;
    const draft = this.draft();
    const text = draft.text;
    if (['q', ':q', '/quit'].includes(text.trim())) {
      this.exitCode = this.data?.run ? runExit({ run: this.data.run }) : 4;
      return;
    }
    if (text.startsWith('/')) {
      draft.text = '';
      draft.cursor = 0;
      return this.command(text);
    }
    const data = this.data;
    if (!data?.run)
      return this.notify('Aucune session ouverte : /new ou Ctrl+B.', 'yellow');
    if (Buffer.byteLength(text) > MAX_JSON_BYTES)
      return this.notify('Message supérieur à 1 MiB : non envoyé.', 'red');
    const target = s.target.get(data.id) ?? 'chief';
    const crew = team(data);
    draft.text = '';
    draft.cursor = 0;
    this.changed();
    try {
      if (target.startsWith('question:')) {
        await this.io.admin('answer', {
          run_id: data.id,
          question_id: target.slice('question:'.length),
          answer: text,
        });
        s.target.set(data.id, 'chief');
        this.notify(
          'Réponse enregistrée et liée à la question ; le chef la lira à son prochain tour.',
          'green',
        );
      } else {
        const response = rec(await this.io.send(data.id, text, target));
        const message = rec(rec(rec(response.result).result));
        const status = str(message.status) ?? 'queued';
        const name =
          target === 'chief'
            ? 'Chef'
            : (crew.byTask.get(target)?.name ?? target);
        const entries = s.pending.get(data.id) ?? [];
        entries.push({
          ...(str(message.id) ? { id: str(message.id)! } : {}),
          at: str(message.created_at) ?? new Date().toISOString(),
          seq: 0,
          who: 'Vous',
          to: name,
          tone: 'cyan',
          label: `message · ${status === 'queued' ? 'enregistré' : status}`,
          text,
        });
        s.pending.set(data.id, entries.slice(-20));
        this.notify(
          `Message pour ${name} enregistré (pas encore transmis : le statut suit dans Carte et Conversation).`,
          'green',
        );
      }
    } catch (error) {
      draft.text = draft.text ? `${text}\n${draft.text}` : text;
      draft.cursor = draft.text.length;
      this.notify(`✗ ${failure(error)} — brouillon conservé.`, 'red', 12);
    }
  }

  private confirmAction(
    text: string,
    run: () => Promise<unknown>,
    done: (result: unknown) => string,
  ): void {
    this.state.confirm = {
      text,
      run: async () => {
        try {
          this.notify(done(await run()), 'green', 10);
        } catch (error) {
          this.notify(`✗ ${failure(error)}`, 'red', 12);
        }
      },
    };
  }
  async command(text: string): Promise<void> {
    const s = this.state;
    const match = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim());
    const name = match?.[1]?.toLowerCase() ?? '';
    const arg = match?.[2]?.trim() ?? '';
    const data = this.data;
    const command = commands(data, s.doctor, viewLabel(s.view)).find(
      (item) => item.name === name,
    );
    if (!command)
      return this.notify(
        `Commande inconnue : /${name}. /help liste les commandes.`,
        'yellow',
      );
    if (command.disabled && name !== 'permissions')
      return this.notify(`⊘ /${name} : ${command.disabled}`, 'yellow', 10);
    const runId = data?.id ?? '';
    const observed = (result: unknown) => {
      const status = str(rec(result).status);
      return status
        ? `état observé : ${status}`
        : 'requête acceptée par le service';
    };
    switch (name) {
      case 'quit':
        this.exitCode = data?.run ? runExit({ run: data.run }) : 4;
        return;
      case 'help':
        s.overlay = 'help';
        return;
      case 'sessions':
        return this.showSessions();
      case 'agents':
        s.overlay = 'agents';
        s.agentsIndex = data ? (s.select.get(data.id) ?? 0) : 0;
        return;
      case 'new':
        return this.openForm();
      case 'cancel':
        return this.notify('Brouillon effacé.', 'dim');
      case 'compose':
        return this.notify(
          'La saisie est déjà multiligne : Alt+Entrée ou Ctrl+J insère une ligne, Entrée envoie.',
          'text',
          10,
        );
      case 'permissions':
        return this.notify(
          `Permissions : ${command.value}. ${command.disabled}`,
          'yellow',
          14,
        );
      case 'view': {
        const views: Record<string, ViewName> = {
          activité: 'activite',
          activite: 'activite',
          carte: 'carte',
          conversation: 'conversation',
        };
        const view = views[arg.toLowerCase()];
        if (!view)
          return this.notify(
            '/view attend activité, carte ou conversation.',
            'yellow',
          );
        s.view = view;
        if (data) s.expanded.set(data.id, null);
        return;
      }
      case 'to': {
        if (!data?.run) return;
        const crew = team(data);
        if (!arg || arg === 'chef') s.target.set(data.id, 'chief');
        else {
          const agent = crew.agents.find((item) => item.name === arg);
          if (!agent) return this.notify(`Agent inconnu : ${arg}.`, 'yellow');
          s.target.set(data.id, agent.key);
        }
        return;
      }
      case 'answer': {
        const parts = /^(\S+)\s+([\s\S]+)$/.exec(arg);
        if (!parts)
          return this.notify('/answer question:ID réponse attendus.', 'yellow');
        try {
          await this.io.admin('answer', {
            run_id: runId,
            question_id: parts[1],
            answer: parts[2],
          });
          this.notify('Réponse enregistrée et liée à la question.', 'green');
        } catch (error) {
          this.notify(`✗ ${failure(error)}`, 'red', 12);
        }
        return;
      }
      case 'provider': {
        if (arg !== 'claude' && arg !== 'codex')
          return this.notify('/provider attend claude ou codex.', 'yellow');
        return this.confirmAction(
          `Remplacer le chef ${providerLabel(str(data?.run?.chief_provider))} par ${providerLabel(arg)} ? Son tour est interrompu ; sa mémoire n’est pas transférée.`,
          () =>
            this.io.admin('replace_chief', {
              run_id: runId,
              provider: arg,
              model: null,
            }),
          (result) =>
            `Chef remplacé par ${providerLabel(arg)} (génération ${str(rec(result).generation) ?? 'nouvelle'}).`,
        );
      }
      case 'model': {
        if (!arg)
          return this.notify(
            '/model attend un identifiant de modèle, ou « défaut ».',
            'yellow',
          );
        const model = ['défaut', 'defaut', 'default'].includes(
          arg.toLowerCase(),
        )
          ? null
          : arg;
        const provider = str(data?.run?.chief_provider);
        return this.confirmAction(
          `Remplacer le chef ${providerLabel(provider)} avec le modèle ${model ?? 'par défaut'} ? Son tour en cours est interrompu.`,
          () =>
            this.io.admin('replace_chief', { run_id: runId, provider, model }),
          () =>
            `Chef relancé avec le modèle ${model ?? 'par défaut'} ; l’acceptation du modèle dépend de la CLI.`,
        );
      }
      case 'pause':
      case 'resume':
        try {
          this.notify(
            `/${name} : ${observed(await this.io.admin(name, { run_id: runId }))}.`,
            'green',
          );
        } catch (error) {
          this.notify(`✗ ${failure(error)}`, 'red', 12);
        }
        return;
      case 'stop':
        return this.confirmAction(
          'Arrêter définitivement cette session ? Elle sera annulée et ne pourra pas être reprise.',
          () => this.io.admin('stop', { run_id: runId }),
          (result) => `Session arrêtée : ${observed(result)}.`,
        );
      case 'reassign': {
        const person = data?.run
          ? team(data).all[s.select.get(data.id) ?? 0]
          : undefined;
        if (!person || person.chief)
          return this.notify(
            'Sélectionnez d’abord un agent (↑↓ sur une saisie vide).',
            'yellow',
          );
        return this.confirmAction(
          `Réattribuer la tâche de ${person.name} ? Son ancienne tentative doit être arrêtée ou réconciliée.`,
          () =>
            this.io.admin('reassign', { run_id: runId, task_id: person.key }),
          () =>
            `Tâche de ${person.name} réattribuée ; une nouvelle génération démarrera.`,
        );
      }
      case 'effort':
      default:
        return this.notify(
          `⊘ /${name} : ${command.disabled ?? 'indisponible'}`,
          'yellow',
          10,
        );
    }
  }

  /** One observation round; returns false while a backlog page is still being read. */
  async poll(): Promise<boolean> {
    const s = this.state;
    s.now = Date.now();
    try {
      if (!this.doctorAsked) {
        this.doctorAsked = true;
        this.io.admin('doctor', {}).then(
          (result) => {
            s.doctor = rec(result);
            this.changed();
          },
          () => {},
        );
      }
      if (s.now - this.lastRuns > 3000) {
        s.runs = list(await this.io.admin('list_runs', {}));
        this.lastRuns = s.now;
        if (this.initial) {
          this.initial = false;
          // Join the run still working; otherwise show the last one created.
          const latest = str(
            (
              s.runs.find(
                (run) =>
                  !['completed', 'failed', 'cancelled'].includes(
                    str(run.status) ?? '',
                  ),
              ) ?? s.runs[0]
            )?.id,
          );
          if (latest) this.open(latest);
          else this.openForm();
        }
      }
      const data = this.data;
      if (!data) {
        s.connection = 'connecté';
        return true;
      }
      const page = await this.io.admin('status', {
        run_id: data.id,
        after_seq: data.cursor,
        limit: PAGE,
      });
      applyStatus(data, page);
      if (data.run) {
        applyTeam(
          data,
          await this.io.execute({
            schema_version: 1,
            request_id: ident('request'),
            idempotency_key: ident('view'),
            run_id: data.id,
            expected_version: Number(data.run.version ?? 0),
            method: 'get_status',
            arguments: { after_seq: data.cursor, limit: 200, task_id: null },
          }),
        );
        if (data.exportWanted && s.now - this.lastExport > 2000) {
          this.lastExport = s.now;
          applyExport(
            data,
            await this.io.admin('export', { run_id: data.id, format: 'json' }),
          );
        }
      }
      s.connection = 'connecté';
      // A size-bounded page can be short while events remain.
      return (
        rec(page).has_more !== true && list(rec(page).events).length < PAGE
      );
    } catch (error) {
      if (
        error instanceof CrewError &&
        error.code === 'SUPERVISOR_UNAVAILABLE'
      ) {
        s.connection = 'reconnexion';
        return true;
      }
      throw error;
    } finally {
      this.changed();
    }
  }
}

export interface TuiOptions {
  project: string;
  run: string | null;
  home?: boolean;
}
/** Full-screen terminal interface; detaching never stops the service or its agents. */
export async function runTui(
  client: SupervisorClient,
  options: TuiOptions,
): Promise<number> {
  const out = process.stdout;
  const state = createState(options.project, options.run);
  const screen = new Screen(out);
  let scheduled = false;
  let broken: unknown = null;
  const draw = () => {
    scheduled = false;
    try {
      state.now = Date.now();
      const frame = renderFrame(state, out.columns ?? 100, out.rows ?? 30);
      screen.draw(frame.lines, frame.cursor);
    } catch (error) {
      // A rendering defect must still restore the terminal before reporting.
      broken ??= error;
      controller.exitCode ??= 1;
      wake?.();
    }
  };
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      setImmediate(draw);
    }
  };
  const controller = new Controller(
    state,
    {
      admin: (method, args) => client.admin({ method, arguments: args }),
      execute: (call) => client.execute(call),
      send: (runId, content, to) => sendMessage(client, runId, content, to),
    },
    schedule,
    options.home ?? false,
  );
  let wake: (() => void) | null = null;
  const stop = () => {
    controller.exitCode ??= 130;
    wake?.();
  };
  const restore = () => screen.leave();
  const keypress = (text: string | undefined, key: Key | undefined) => {
    void controller
      .key(text, key ?? {})
      .catch((error) => controller.notify(`✗ ${failure(error)}`, 'red'))
      .finally(() => {
        schedule();
        if (controller.exitCode !== null) wake?.();
      });
  };
  const resized = () => {
    screen.invalidate();
    schedule();
  };
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on('keypress', keypress);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', restore);
  out.on('resize', resized);
  screen.enter();
  schedule();
  try {
    while (controller.exitCode === null) {
      const settled = await controller.poll();
      if (controller.exitCode !== null) break;
      if (settled)
        await Promise.race([
          delay(500),
          new Promise<void>((resolve) => {
            wake = resolve;
          }),
        ]);
      wake = null;
    }
    if (broken) throw broken;
    return controller.exitCode;
  } finally {
    process.stdin.off('keypress', keypress);
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    process.off('exit', restore);
    out.off('resize', resized);
    restore();
    const run = state.current;
    out.write(
      run
        ? `Vue détachée ; le service et les agents continuent. Reprendre : avity-crew attach --run ${run}\n`
        : 'Vue fermée ; aucun objectif envoyé.\n',
    );
  }
}
