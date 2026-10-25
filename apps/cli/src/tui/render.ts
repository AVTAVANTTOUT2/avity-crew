import { basename } from 'node:path';
import { cellWidth } from '../view.ts';
import type { Draft, State } from './app.ts';
import {
  activity,
  alerts,
  clock,
  conversation,
  delivery,
  exchanges,
  paletteItems,
  providerLabel,
  stateLabel,
  stateMark,
  str,
  taskCounts,
  team,
  usage,
} from './model.ts';
import type { Line, Participant, RunData, Team } from './model.ts';
import { Canvas, graphemes, textWidth, wrap } from './term.ts';
import type { Span, Style, Tone } from './term.ts';

/** AVT emblem: the two arcs of the logo around the letters, sampled from the source image. */
export const LOGO = [
  '                 ▄▄▄███▀▀',
  '             ▄▄████▀▀               ▄',
  '          ▄▄████▀▀                  ▀█▄▄',
  '        ▄█████▀                       ███',
  '       ▄█████▀                         ███▄',
  '      ██████                            ████',
  '     ██████                             ▀████',
  '    ██████    ▄█▄    ██     ██ ████████  ████▄',
  '   ▄█████▀   ██▀██    ██   ██     ██     █████',
  '   ██████   ██▄▄▄██    ██ ██      ██     █████▄',
  '    ▀████   ██▀▀▀██     ███       ██     ██████',
  '     ▀███   ██   ██      ▀        ██     ██████',
  '   ██  ▀█                               ▄█████▀',
  '    ██▄▄                            ▄▀ ▄██████',
  '    ▀████▄                       ▄▄█▀  ██████▀',
  '     ████████▄▄             ▄▄▄████▀ ▄██████▀',
  '      ▀██████████████████████████▀  ███████▀',
  '       ▀███████████████████████▀  ▄███████',
  '         ▀█████████████████▀▀  ▄▄███████▀',
  '             ▀▀▀▀▀▀▀▀▀▀▀   ▄▄████████▀▀',
  '                ▄▄▄▄▄▄▄▄██████████▀▀',
  '                   ▀▀▀▀▀▀▀▀▀▀▀▀',
];
export const SIGNATURE: Span[] = [
  ['◜', { fg: 'avt' }],
  ['AVT', { fg: 'avt', bold: true }],
  ['◞', { fg: 'avt' }],
];
const dim: Style = { fg: 'dim' };
const bold: Style = { bold: true };
const views = [
  ['activite', 'Activité'],
  ['carte', 'Carte'],
  ['conversation', 'Conversation'],
] as const;
export const viewLabel = (view: string): string =>
  views.find(([id]) => id === view)?.[1] ?? view;

export interface Frame {
  lines: string[];
  plain: string[];
  cursor: { x: number; y: number } | null;
}
interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Caret-aware layout of the multiline draft; wrapping is by grapheme columns. */
export function layoutDraft(draft: Draft, width: number) {
  const rows = [''];
  let used = 0,
    index = 0,
    row = 0,
    col = 0,
    placed = false;
  for (const part of graphemes(draft.text)) {
    const size = part === '\n' ? 0 : cellWidth(part);
    if (part !== '\n' && used + size > width) {
      rows.push('');
      used = 0;
    }
    if (index === draft.cursor) {
      row = rows.length - 1;
      col = used;
      placed = true;
    }
    index += part.length;
    if (part === '\n') {
      rows.push('');
      used = 0;
    } else {
      rows[rows.length - 1] += part;
      used += size;
    }
  }
  if (!placed) {
    if (used >= width) {
      rows.push('');
      used = 0;
    }
    row = rows.length - 1;
    col = used;
  }
  return { rows, row, col };
}

const kindStyle: Record<Line['kind'], [string, Style, Style]> = {
  run: ['▸ exec ', { fg: 'text', bold: true }, dim],
  edit: ['▸ modif ', { fg: 'text', bold: true }, dim],
  new: ['▸ créé ', { fg: 'text', bold: true }, dim],
  del: ['▸ suppr ', { fg: 'red', bold: true }, dim],
  read: ['▸ lit ', { fg: 'text', bold: true }, dim],
  tool: ['▸ ', { fg: 'text', bold: true }, dim],
  ok: ['  ✓ ', { fg: 'green' }, { fg: 'green' }],
  fail: ['  ✗ ', { fg: 'red' }, { fg: 'red' }],
  add: ['+ ', { fg: 'green', bg: 'addBg' }, { fg: 'green', bg: 'addBg' }],
  rem: ['- ', { fg: 'red', bg: 'delBg' }, { fg: 'red', bg: 'delBg' }],
  text: ['◇ ', { fg: 'text' }, { fg: 'text' }],
  error: ['✗ ', { fg: 'red', bold: true }, { fg: 'red' }],
  perm: ['⚠ ', { fg: 'red', bold: true }, { fg: 'red' }],
  report: ['↑ ', { fg: 'green', bold: true }, { fg: 'green' }],
  block: ['■ ', { fg: 'red', bold: true }, { fg: 'red' }],
  deleg: ['↔ ', { fg: 'cyan', bold: true }, { fg: 'cyan' }],
  info: ['· ', dim, dim],
};
function lineSpans(line: Line): Span[] {
  const [prefix, head, body] = kindStyle[line.kind];
  return [
    [prefix, head],
    [line.text.replaceAll('\n', ' ⏎ '), body],
  ];
}
/** Diff rows are painted to the panel edge so additions/removals read as blocks. */
function drawLine(c: Canvas, x: number, y: number, end: number, line: Line) {
  if (line.kind === 'add' || line.kind === 'rem')
    c.fill(x, y, end - x, 1, kindStyle[line.kind][1]);
  c.spans(x, y, lineSpans(line), end);
}
function mark(status: string | null, extra = ''): Span[] {
  const [symbol, tone] = stateMark(status);
  return [[`${symbol} ${stateLabel(status)}${extra}`, { fg: tone }]];
}
const short = (value: string | null, size = 8): string =>
  value ? (value.length > size ? value.slice(0, size) + '…' : value) : '';

function header(
  c: Canvas,
  state: State,
  data: RunData | null,
  crew: Team | null,
) {
  c.fill(0, 0, c.width, 2, { bg: 'raised' });
  const raised = (style: Style): Style => ({ ...style, bg: 'raised' });
  let x = c.spans(
    1,
    0,
    SIGNATURE.map(([t, s]) => [t, raised(s)] as Span),
  );
  x = c.text(x, 0, ' Avity Crew', raised(bold));
  const right: Span[] =
    state.connection === 'connecté'
      ? [['● service connecté', raised({ fg: 'green' })]]
      : state.connection === 'chargement'
        ? [['◌ chargement…', raised({ fg: 'yellow' })]]
        : [['◌ service indisponible — reconnexion…', raised({ fg: 'yellow' })]];
  const rightWidth = right.reduce((sum, [t]) => sum + textWidth(t), 0);
  const end = c.width - rightWidth - 2;
  c.spans(end + 1, 0, right);
  const project = str(data?.project.root) ?? state.projectRoot;
  x = c.text(x, 0, ' │ ', raised(dim), end);
  if (data?.run && crew) {
    // The state and the session stay visible; chief and project give way first.
    x = c.spans(
      x,
      0,
      mark(str(data.run.status)).map(([t, s]) => [t, raised(s)] as Span),
      end,
    );
    x = c.text(
      x + 1,
      0,
      (str(data.run.objective) ?? '').replaceAll('\n', ' '),
      raised(bold),
      Math.min(end, x + 1 + Math.max(16, Math.floor(c.width / 3))),
    );
    x = c.spans(
      x,
      0,
      [
        [' │ chef ', raised(dim)],
        [
          `${providerLabel(crew.chief.provider)} · ${crew.chief.model ?? 'modèle par défaut'}`,
          raised({ fg: 'text' }),
        ],
      ],
      end,
    );
  } else x = c.text(x, 0, 'nouvelle session', raised(bold), end);
  c.text(x, 0, ` │ projet ${basename(project)}`, raised(dim), end);
  if (!data?.run || state.form) {
    c.text(1, 1, `Projet : ${project}`, raised(dim));
    return;
  }
  x = 1;
  for (const [id, label] of views) {
    const active = state.view === id && !state.expanded.get(data.id);
    x = c.text(
      x,
      1,
      active ? ` ◆ ${label} ` : `   ${label} `,
      raised(active ? { fg: 'avt', bold: true, underline: true } : dim),
    );
  }
  const turns = data.activity
    ? `tours actifs ${data.activity.active.filter((turn) => turn.run_id === data.id).length} · en file ${data.activity.queued.filter((turn) => turn.run_id === data.id).length}`
    : 'tours : indisponible';
  c.spans(x + 2, 1, [
    [
      `chef + ${crew?.agents.length ?? 0} agent(s) · ${turns} · capacité ${str(data.run.max_active_agents) ?? '?'}`,
      raised(dim),
    ],
  ]);
}

function sessionsList(
  c: Canvas,
  state: State,
  area: Area,
  selected: number | null,
  title: string,
) {
  c.fill(area.x, area.y, area.w, area.h, {});
  c.box(area.x, area.y, area.w, area.h, {
    heavy: selected !== null,
    style: selected === null ? { fg: 'border' } : { fg: 'cyan' },
    title: [[title, bold]],
    right: [[selected === null ? 'Ctrl+B' : 'Entrée ouvrir · Échap', dim]],
  });
  const rows: { id: string | null; spans: Span[]; sub: Span[] }[] = [
    {
      id: null,
      spans: [
        [selected === 0 ? '▸ ' : '  ', { fg: 'cyan' }],
        ['+ Nouvelle session', { fg: 'cyan', bold: true }],
      ],
      sub: [['    /new', dim]],
    },
    ...state.runs.map((run, index) => {
      const [symbol, tone] = stateMark(str(run.status));
      const current = run.id === state.current;
      const marker = selected === null ? current : selected === index + 1;
      return {
        id: String(run.id),
        spans: [
          [marker ? '▸ ' : '  ', { fg: 'cyan' }],
          [`${symbol} `, { fg: tone }],
          [
            (str(run.objective) ?? String(run.id)).replaceAll('\n', ' '),
            current ? { fg: 'cyan', bold: true } : bold,
          ],
        ] as Span[],
        sub: [
          [
            `    ${stateLabel(str(run.status))} · ${providerLabel(str(run.chief_provider))}${current ? ' · ouverte' : ''}`,
            dim,
          ],
        ] as Span[],
      };
    }),
  ];
  const capacity = Math.max(1, Math.floor((area.h - 2) / 2));
  const focus =
    selected ??
    Math.max(
      0,
      rows.findIndex((row) => row.id === state.current),
    );
  const top = Math.max(
    0,
    Math.min(focus - capacity + 1, rows.length - capacity),
  );
  rows.slice(top, top + capacity).forEach((row, index) => {
    const y = area.y + 1 + index * 2;
    if (selected !== null && top + index === selected)
      c.fill(area.x + 1, y, area.w - 2, 2, { bg: 'selBg' });
    const style = (s: Style): Style =>
      selected !== null && top + index === selected ? { ...s, bg: 'selBg' } : s;
    c.spans(
      area.x + 2,
      y,
      row.spans.map(([t, s]) => [t, style(s)] as Span),
      area.x + area.w - 2,
    );
    c.spans(
      area.x + 2,
      y + 1,
      row.sub.map(([t, s]) => [t, style(s)] as Span),
      area.x + area.w - 2,
    );
  });
  if (rows.length > capacity)
    c.text(
      area.x + 2,
      area.y + area.h - 1,
      ` ${rows.length - 1} session(s) `,
      dim,
    );
}

function panel(
  c: Canvas,
  area: Area,
  data: RunData,
  person: Participant,
  selected: boolean,
  rows: Line[],
) {
  const provider = providerLabel(person.provider);
  c.box(area.x, area.y, area.w, area.h, {
    heavy: selected,
    style: selected ? { fg: 'cyan' } : { fg: 'border' },
    title: [
      [
        person.chief ? '◆ ' : selected ? '◆ ' : '',
        { fg: person.chief ? 'avt' : 'cyan' },
      ],
      [person.name, bold],
      [` · ${person.role}`, dim],
    ],
    right: [
      [provider + (person.model ? ` · ${person.model}` : ''), { fg: 'text' }],
    ],
    footer: mark(
      person.status,
      person.chief
        ? person.active
          ? ' · tour actif'
          : person.active === false
            ? ' · aucun tour actif'
            : ''
        : person.wait
          ? ` — ${person.wait}`
          : '',
    ),
    footerRight: person.native
      ? [[`session native ${short(person.native)}`, dim]]
      : [['session native : indisponible', dim]],
  });
  const left = area.x + 2,
    end = area.x + area.w - 2;
  const inner = area.h - 2;
  if (inner <= 0) return;
  c.spans(
    left,
    area.y + 1,
    [
      [person.chief ? 'Objectif : ' : 'Mission : ', dim],
      [person.mission.replaceAll('\n', ' '), { fg: 'text' }],
    ],
    end,
  );
  const summary = person.chief ? null : compactDelivery(data, person);
  const room = inner - 1 - (summary ? 1 : 0);
  const shown = rows.slice(-Math.max(0, room));
  if (!rows.length && room > 0)
    c.text(
      left,
      area.y + 2,
      person.chief
        ? 'Aucune activité observée pour le chef.'
        : 'Aucune action observée pour cet agent.',
      dim,
      end,
    );
  shown.forEach((line, index) =>
    drawLine(c, left, area.y + 2 + index, end, line),
  );
  if (summary) c.spans(left, area.y + area.h - 2, summary, end);
}
function compactDelivery(data: RunData, person: Participant): Span[] {
  const [done, tested, validated] = delivery(data, person);
  const piece = (line: Line | undefined, label: string): Span => {
    const tone: Tone =
      line?.kind === 'ok' ? 'green' : line?.kind === 'info' ? 'dim' : 'red';
    const symbol =
      line?.kind === 'ok' ? '✓' : line?.kind === 'info' ? '◌' : '✗';
    return [`${symbol} ${label}`, { fg: tone }];
  };
  return [
    piece(done, 'terminé'),
    ['  ', dim],
    piece(tested, 'testé'),
    ['  ', dim],
    piece(validated, 'validé'),
  ];
}

function scrolled<T>(
  state: State,
  key: string,
  rows: T[],
  height: number,
): { rows: T[]; offset: number; above: number } {
  let offset = state.scroll.get(key) ?? 0;
  const previous = state.counts.get(key);
  if (offset > 0 && previous !== undefined && rows.length > previous)
    offset += rows.length - previous;
  offset = Math.max(0, Math.min(offset, rows.length - height));
  state.scroll.set(key, offset);
  state.counts.set(key, rows.length);
  const end = rows.length - offset;
  const start = Math.max(0, end - height);
  return { rows: rows.slice(start, end), offset, above: start };
}

function detail(
  c: Canvas,
  state: State,
  area: Area,
  data: RunData,
  crew: Team,
  person: Participant,
) {
  c.box(area.x, area.y, area.w, area.h, {
    heavy: true,
    style: { fg: 'cyan' },
    title: [
      ['◆ ', { fg: person.chief ? 'avt' : 'cyan' }],
      [person.name, bold],
      [` · ${person.role} · ${providerLabel(person.provider)}`, dim],
    ],
    right: [['Échap revenir · ↑↓ PgPréc PgSuiv défiler', dim]],
  });
  const width = area.w - 4;
  const rows: Span[][] = [];
  const add = (label: string, value: string, style: Style = { fg: 'text' }) => {
    const parts = wrap(
      value || 'indisponible',
      Math.max(10, width - textWidth(label)),
    );
    parts.forEach((part, index) =>
      rows.push([
        [index ? ' '.repeat(textWidth(label)) : label, dim],
        [part, style],
      ]),
    );
  };
  add(
    'Fournisseur : ',
    `${providerLabel(person.provider)} · modèle ${person.model ?? 'par défaut'} · session native ${person.native ? `${person.native}${person.cli ? ' (CLI ' + person.cli + ')' : ''}` : 'indisponible (pas encore observée)'}`,
  );
  add(
    'État : ',
    `${stateMark(person.status)[0]} ${stateLabel(person.status)}${person.wait ? ' — ' + person.wait : ''}${person.chief ? '' : ` · tâche ${person.key} · dépend de : ${person.dependsOn.join(', ') || 'aucune'}`}`,
    { fg: stateMark(person.status)[1] },
  );
  add(
    person.chief ? 'Objectif : ' : 'Mission : ',
    person.objective || person.mission,
  );
  person.criteria
    .filter(Boolean)
    .forEach((criterion, index) =>
      add(index ? '           ' : 'Critères : ', '• ' + criterion),
    );
  if (person.chief) add('Tâches : ', taskCounts(data));
  const spent = usage(data, person);
  if (spent) add('Usage : ', spent);
  for (const line of delivery(data, person)) rows.push(lineSpans(line));
  // Identity and delivery stay pinned; only the history below scrolls.
  const pinned = rows.slice(0, Math.max(3, Math.floor((area.h - 2) * 0.6)));
  const history = activity(data, crew, person);
  const past: Span[][] = [];
  if (!history.length)
    past.push([['Aucun événement enregistré pour ce participant.', dim]]);
  for (const line of history) {
    const time: Span = [line.at ? clock(line.at) + ' ' : '         ', dim];
    if (['text', 'error', 'report', 'perm'].includes(line.kind)) {
      const [prefix, head, body] = kindStyle[line.kind];
      wrap(line.text, width - 12).forEach((part, index) =>
        past.push([
          index ? ['         ', dim] : time,
          [index ? '  ' : prefix, head],
          [part, body],
        ]),
      );
    } else past.push([time, ...lineSpans(line)]);
  }
  pinned.forEach((spans, index) =>
    c.spans(area.x + 2, area.y + 1 + index, spans, area.x + area.w - 2),
  );
  const ruleY = area.y + 1 + pinned.length;
  c.text(
    area.x + 2,
    ruleY,
    `── Historique observé (${history.length}) `.padEnd(width, '─'),
    { fg: 'border' },
    area.x + area.w - 2,
  );
  const view = scrolled(
    state,
    `${data.id}:detail:${person.key}`,
    past,
    Math.max(1, area.y + area.h - 2 - ruleY),
  );
  view.rows.forEach((spans, index) =>
    c.spans(area.x + 2, ruleY + 1 + index, spans, area.x + area.w - 2),
  );
  if (view.offset > 0)
    c.text(
      area.x + 2,
      area.y + area.h - 1,
      ` ▼ ${view.offset} ligne(s) plus récentes · Fin `,
      { fg: 'cyan' },
    );
  else if (view.above > 0)
    c.text(
      area.x + 2,
      area.y + area.h - 1,
      ` ▲ ${view.above} ligne(s) plus anciennes · PgPréc `,
      dim,
    );
}

/** Chief summary: latest reply, decision and delegations before raw tool lines. */
function chiefLines(data: RunData, crew: Team): Line[] {
  const all = activity(data, crew, crew.chief);
  const rows = all
    .filter((line) => line.kind !== 'text' && line.kind !== 'deleg')
    .slice(-3);
  const decision = data.decisions.at(-1);
  if (decision)
    rows.push({
      kind: decision.status === 'approved' ? 'ok' : 'info',
      text: `décision ${decision.status === 'approved' ? 'approuvée' : String(decision.status ?? '')} : ${String(decision.question ?? '')} → ${String(decision.answer ?? '')}`,
      at: str(decision.created_at),
    });
  const delegated = crew.agents.filter((agent) =>
    data.events.some(
      (event) => event.type === 'task.delegated' && event.task_id === agent.key,
    ),
  );
  if (delegated.length)
    rows.push({
      kind: 'deleg',
      text: `délégations (${delegated.length}) : ${delegated.map((agent) => `${agent.name} → ${providerLabel(agent.provider)}`).join(', ')}`,
      at: null,
    });
  const reply = all.filter((line) => line.kind === 'text').at(-1);
  if (reply) rows.push(reply);
  return rows;
}

function activityView(
  c: Canvas,
  state: State,
  area: Area,
  data: RunData,
  crew: Team,
) {
  const selected = state.select.get(data.id) ?? 0;
  const chiefH = crew.agents.length
    ? Math.max(area.h < 18 ? 4 : 6, Math.min(10, Math.floor(area.h * 0.3)))
    : Math.min(area.h, 12);
  panel(
    c,
    { ...area, h: chiefH },
    data,
    crew.chief,
    selected === 0,
    chiefLines(data, crew),
  );
  const top = area.y + chiefH;
  let height = area.h - chiefH;
  if (height < 1) return;
  if (!crew.agents.length) {
    if (height < 3) return;
    c.box(area.x, top, area.w, height, { title: [['Équipe', bold]] });
    c.text(
      area.x + 2,
      top + 1,
      'Aucun agent pour l’instant : le chef n’a encore créé aucune tâche.',
      dim,
      area.x + area.w - 2,
    );
    return;
  }
  if (height < 6) {
    // Too short for panels: one factual line per agent, selection kept.
    const shown = crew.agents.length > height ? height - 1 : height;
    crew.agents.slice(0, shown).forEach((agent, index) => {
      const focused = selected === index + 1;
      const y = top + index;
      if (focused) c.fill(area.x, y, area.w, 1, { bg: 'selBg' });
      const base = (style: Style): Style =>
        focused ? { ...style, bg: 'selBg' } : style;
      c.spans(
        area.x + 1,
        y,
        [
          [focused ? '▸ ' : '  ', base({ fg: 'cyan' })],
          [agent.name, base(bold)],
          [` · ${providerLabel(agent.provider)} · `, base(dim)],
          ...mark(agent.status).map(([t, st]) => [t, base(st)] as Span),
          [` · ${agent.mission}`, base(dim)],
        ],
        area.x + area.w - 1,
      );
    });
    if (crew.agents.length > shown)
      c.text(
        area.x + 3,
        top + shown,
        `… +${crew.agents.length - shown} agent(s) : vue Carte ou ↑↓`,
        { fg: 'cyan' },
        area.x + area.w - 1,
      );
    return;
  }
  const cols = area.w >= 96 ? 2 : 1;
  const lines = Math.ceil(crew.agents.length / cols);
  let panelH = Math.min(
    height,
    Math.max(7, Math.min(13, Math.floor(height / lines))),
  );
  let visible = Math.max(1, Math.floor(height / panelH));
  if (visible < lines) {
    // Keep one row for the scroll indicator, without shrinking text below legibility.
    height -= 1;
    panelH = Math.min(height, panelH);
    visible = Math.max(1, Math.floor(height / panelH));
    panelH = Math.floor(height / visible);
  }
  const focusRow = selected > 0 ? Math.floor((selected - 1) / cols) : 0;
  let first = state.mosaicTop.get(data.id) ?? 0;
  if (focusRow < first) first = focusRow;
  if (focusRow >= first + visible) first = focusRow - visible + 1;
  first = Math.max(0, Math.min(first, Math.max(0, lines - visible)));
  state.mosaicTop.set(data.id, first);
  const colW = Math.floor(area.w / cols);
  crew.agents.forEach((agent, index) => {
    const row = Math.floor(index / cols) - first;
    if (row < 0 || row >= visible) return;
    const col = index % cols;
    panel(
      c,
      {
        x: area.x + col * colW,
        y: top + row * panelH,
        w: col === cols - 1 ? area.w - col * colW : colW,
        h: panelH,
      },
      data,
      agent,
      selected === index + 1,
      activity(data, crew, agent),
    );
  });
  const hiddenAbove = first * cols,
    hiddenBelow = Math.max(0, crew.agents.length - (first + visible) * cols);
  if (hiddenAbove || hiddenBelow)
    c.text(
      area.x + 2,
      area.y + area.h - 1,
      ` ${hiddenAbove ? `↑ ${hiddenAbove} au-dessus` : ''}${hiddenAbove && hiddenBelow ? ' · ' : ''}${hiddenBelow ? `↓ ${hiddenBelow} en dessous` : ''} — ↑↓ pour parcourir `,
      { fg: 'cyan' },
    );
}

function node(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  person: Participant,
  selected: boolean,
) {
  const [symbol, tone] = stateMark(person.status);
  c.fill(x, y, w, 4, {});
  c.box(x, y, w, 4, {
    heavy: selected,
    style: selected
      ? { fg: 'cyan' }
      : person.chief
        ? { fg: 'avt' }
        : { fg: 'border' },
    title: [
      [person.chief ? '◆ ' : '', { fg: 'avt' }],
      [person.name, bold],
    ],
    right: [
      [
        person.provider === 'claude'
          ? 'Claude'
          : person.provider === 'codex'
            ? 'Codex'
            : person.provider
              ? 'fake'
              : '?',
        { fg: 'text' },
      ],
    ],
  });
  c.text(
    x + 2,
    y + 1,
    person.chief
      ? `orchestrateur · ${person.model ?? 'modèle par défaut'}`
      : person.role,
    dim,
    x + w - 2,
  );
  c.text(
    x + 2,
    y + 2,
    `${symbol} ${stateLabel(person.status)}${person.chief && person.active ? ' · tour actif' : ''}`,
    { fg: tone },
    x + w - 2,
  );
}
function line(
  c: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  style: Style,
) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0) * 2, 1);
  for (let step = 0; step <= steps; step++) {
    const x = Math.round(x0 + ((x1 - x0) * step) / steps),
      y = Math.round(y0 + ((y1 - y0) * step) / steps);
    if (c.rows[y]?.[x]?.ch === ' ') c.text(x, y, '·', style);
  }
}
function mapView(
  c: Canvas,
  state: State,
  area: Area,
  data: RunData,
  crew: Team,
) {
  const selected = state.select.get(data.id) ?? 0;
  const journalH = Math.max(5, Math.min(12, Math.floor(area.h * 0.35)));
  const mapArea = { ...area, h: area.h - journalH };
  c.text(
    area.x + 1,
    area.y,
    `Tâches : ${taskCounts(data)}`,
    dim,
    area.x + area.w - 1,
  );
  const map = { ...mapArea, y: mapArea.y + 1, h: mapArea.h - 1 };
  const boxW = Math.max(18, Math.min(26, Math.floor(map.w / 5)));
  const chiefW = Math.min(map.w, 28);
  const n = crew.agents.length;
  const cx = map.x + Math.floor(map.w / 2),
    cy = map.y + Math.floor(map.h / 2);
  const rx = Math.floor((map.w - boxW) / 2) - 1,
    ry = Math.floor((map.h - 4) / 2);
  const start = -Math.PI / 2 + (n % 2 === 0 && n > 0 ? Math.PI / n : 0);
  const spots = crew.agents.map((_, index) => {
    const angle = start + (2 * Math.PI * index) / Math.max(1, n);
    const x = Math.round(cx + rx * Math.cos(angle) - boxW / 2),
      y = Math.round(cy + ry * Math.sin(angle) - 2);
    return { x, y, w: boxW, h: 4 };
  });
  const chiefBox = {
    x: cx - Math.floor(chiefW / 2),
    y: cy - 2,
    w: chiefW,
    h: 4,
  };
  const boxes = [chiefBox, ...spots];
  const overlap = (a: Area, b: Area) =>
    a.x < b.x + b.w + 1 &&
    b.x < a.x + a.w + 1 &&
    a.y < b.y + b.h &&
    b.y < a.y + a.h;
  const radial =
    map.w >= 70 &&
    map.h >= 14 &&
    boxes.every(
      (box) =>
        box.x >= map.x &&
        box.y >= map.y &&
        box.x + box.w <= map.x + map.w &&
        box.y + box.h <= map.y + map.h,
    ) &&
    boxes.every((a, i) => boxes.every((b, j) => i >= j || !overlap(a, b)));
  const flows = exchanges(data, crew);
  if (radial) {
    const centre = (box: Area) =>
      [box.x + Math.floor(box.w / 2), box.y + Math.floor(box.h / 2)] as const;
    const position = new Map<string, readonly [number, number]>([
      ['chief', centre(chiefBox)],
      ['user', centre(chiefBox)],
      ...crew.agents.map(
        (agent, index) => [agent.key, centre(spots[index]!)] as const,
      ),
    ]);
    for (const spot of spots)
      line(c, ...centre(chiefBox), ...centre(spot), { fg: 'border' });
    for (const flow of flows)
      if (
        flow.fromKey &&
        flow.toKey &&
        flow.fromKey !== 'chief' &&
        flow.toKey !== 'chief' &&
        flow.fromKey !== 'user' &&
        flow.toKey !== 'user'
      ) {
        const a = position.get(flow.fromKey),
          b = position.get(flow.toKey);
        if (a && b) line(c, a[0], a[1], b[0], b[1], { fg: 'border' });
      }
    // A marker appears only for an exchange recorded in the last seconds; nothing animates idly.
    for (const flow of flows) {
      const age = state.now - Date.parse(flow.at);
      if (!(age >= -2000 && age < 15_000) || !flow.fromKey || !flow.toKey)
        continue;
      const a = position.get(flow.fromKey),
        b = position.get(flow.toKey);
      if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
      for (const [t, symbol] of [
        [0.28, '•'],
        [0.38, '●'],
      ] as const) {
        const x = Math.round(a[0] + (b[0] - a[0]) * t),
          y = Math.round(a[1] + (b[1] - a[1]) * t);
        c.text(x, y, symbol, {
          fg: flow.tone === 'dim' ? 'cyan' : flow.tone,
          bold: true,
        });
      }
    }
    node(c, chiefBox.x, chiefBox.y, chiefBox.w, crew.chief, selected === 0);
    crew.agents.forEach((agent, index) =>
      node(
        c,
        spots[index]!.x,
        spots[index]!.y,
        boxW,
        agent,
        selected === index + 1,
      ),
    );
  } else {
    const rows: { spans: Span[]; who: number }[] = [];
    const describe = (person: Participant): Span[] => [
      [person.chief ? '◆ ' : '', { fg: 'avt' }],
      [person.name, bold],
      [` · ${person.role} · ${providerLabel(person.provider)} · `, dim],
      ...mark(person.status),
    ];
    rows.push({ spans: describe(crew.chief), who: 0 });
    crew.agents.forEach((agent, index) => {
      const last = index === crew.agents.length - 1;
      rows.push({
        spans: [[last ? '└─ ' : '├─ ', { fg: 'border' }], ...describe(agent)],
        who: index + 1,
      });
      rows.push({
        spans: [
          [last ? '     ' : '│    ', { fg: 'border' }],
          [agent.mission.replaceAll('\n', ' '), dim],
          [
            agent.dependsOn.length
              ? `  (dépend de ${agent.dependsOn.join(', ')})`
              : '',
            dim,
          ],
        ],
        who: index + 1,
      });
    });
    if (!crew.agents.length)
      rows.push({ spans: [['   Aucun agent pour l’instant.', dim]], who: -1 });
    const first = Math.max(
      0,
      Math.min(
        rows.findIndex((row) => row.who === selected) - map.h + 2,
        rows.length - map.h,
      ),
    );
    rows
      .slice(Math.max(0, first), Math.max(0, first) + map.h)
      .forEach((row, index) => {
        const y = map.y + index;
        const focused = row.who === selected;
        if (focused) c.fill(map.x, y, map.w, 1, { bg: 'selBg' });
        c.spans(
          map.x + 1,
          y,
          row.spans.map(
            ([t, s]) => [t, focused ? { ...s, bg: 'selBg' } : s] as Span,
          ),
          map.x + map.w - 1,
        );
      });
  }
  const journal = {
    x: area.x,
    y: area.y + area.h - journalH,
    w: area.w,
    h: journalH,
  };
  c.box(journal.x, journal.y, journal.w, journal.h, {
    title: [['Journal des échanges', bold]],
    right: [['enregistré › transmis › reçu › prise en compte déclarée', dim]],
  });
  const rows: Span[][] = flows.map((flow) => [
    [clock(flow.at), dim],
    [' · ', dim],
    [
      flow.from,
      {
        fg:
          flow.fromKey === 'user'
            ? 'cyan'
            : flow.fromKey === 'chief'
              ? 'avt'
              : 'text',
        bold: true,
      },
    ],
    [' → ', { fg: 'cyan' }],
    [
      flow.to,
      {
        fg:
          flow.toKey === 'user'
            ? 'cyan'
            : flow.toKey === 'chief'
              ? 'avt'
              : 'text',
        bold: true,
      },
    ],
    [' · ', dim],
    [`[${flow.status}] `, { fg: flow.tone }],
    [flow.text.replaceAll('\n', ' '), { fg: 'text' }],
  ]);
  if (!rows.length)
    rows.push([['Aucun échange enregistré pour cette session.', dim]]);
  const view = scrolled(state, `${data.id}:journal`, rows, journal.h - 2);
  view.rows.forEach((spans, index) =>
    c.spans(
      journal.x + 2,
      journal.y + 1 + index,
      spans,
      journal.x + journal.w - 2,
    ),
  );
  if (view.offset > 0)
    c.text(
      journal.x + 2,
      journal.y + journal.h - 1,
      ` ▼ ${view.offset} plus récent(s) · Fin `,
      { fg: 'cyan' },
    );
}

function conversationView(
  c: Canvas,
  state: State,
  area: Area,
  data: RunData,
  crew: Team,
) {
  c.box(area.x, area.y, area.w, area.h, {
    title: [['Conversation avec le chef', bold]],
    right: [['↑↓ PgPréc PgSuiv défiler · Fin', dim]],
  });
  const width = area.w - 4;
  const rows: Span[][] = [];
  const entries = conversation(data, crew, state.pending.get(data.id) ?? []);
  for (const entry of entries) {
    if (rows.length) rows.push([]);
    rows.push([
      [clock(entry.at) + ' ', dim],
      [entry.who, { fg: entry.tone, bold: true }],
      [entry.to ? ` → ${entry.to}` : '', { fg: 'text' }],
      [` · ${entry.label}`, dim],
    ]);
    for (const part of wrap(entry.text || ' ', width - 2))
      rows.push([
        ['  ', {}],
        [part, { fg: 'text' }],
      ]);
  }
  if (!rows.length)
    rows.push([
      [
        'Aucun message pour l’instant. Écrivez au chef dans la zone de saisie.',
        dim,
      ],
    ]);
  const view = scrolled(state, `${data.id}:conversation`, rows, area.h - 2);
  view.rows.forEach((spans, index) =>
    c.spans(area.x + 2, area.y + 1 + index, spans, area.x + area.w - 2),
  );
  if (view.offset > 0)
    c.text(
      area.x + 2,
      area.y + area.h - 1,
      ` ▼ ${view.offset} ligne(s) plus récentes · Fin pour revenir `,
      { fg: 'cyan' },
    );
  else if (view.above > 0)
    c.text(
      area.x + 2,
      area.y + area.h - 1,
      ` ▲ ${view.above} ligne(s) plus anciennes `,
      dim,
    );
}

function home(
  c: Canvas,
  state: State,
  area: Area,
): { x: number; y: number } | null {
  const formH = 18;
  const logoW = 47;
  const side = area.w >= logoW + 56 && area.h >= LOGO.length + 3;
  const stacked =
    !side && area.h >= LOGO.length + formH + 2 && area.w >= logoW + 2;
  if (side || stacked) {
    const lx = side ? area.x + 2 : area.x + Math.floor((area.w - logoW) / 2);
    const ly = side
      ? area.y + Math.max(0, Math.floor((area.h - LOGO.length - 3) / 2))
      : area.y;
    LOGO.forEach((row, index) => c.text(lx, ly + index, row, { fg: 'avt' }));
    const tag = ly + LOGO.length + 1;
    c.text(lx + 9, tag, 'Avity Crew', { fg: 'avt', bold: true });
    c.text(lx + 4, tag + 1, 'Équipe locale Claude Code · Codex', dim);
  } else {
    c.spans(area.x + 2, area.y, [
      ...SIGNATURE,
      [' Avity Crew', { fg: 'avt', bold: true }],
      [' — équipe locale Claude Code · Codex', dim],
    ]);
  }
  if (!state.form) {
    const y = side
      ? area.y + 2
      : stacked
        ? area.y + LOGO.length + 4
        : area.y + 2;
    const x = side ? area.x + logoW + 6 : area.x + 2;
    c.text(x, y, 'Aucune session ouverte.', bold);
    c.text(
      x,
      y + 1,
      '/new crée une session · Ctrl+B ou /sessions ouvre une session existante.',
      dim,
    );
    return null;
  }
  const box = side
    ? {
        x: area.x + logoW + 3,
        y: area.y + Math.max(0, Math.floor((area.h - formH) / 2)),
        w: area.w - logoW - 3,
        h: Math.min(formH, area.h),
      }
    : stacked
      ? {
          x: area.x + 1,
          y: area.y + LOGO.length + 3,
          w: area.w - 2,
          h: Math.min(formH, area.h - LOGO.length - 3),
        }
      : { x: area.x, y: area.y + 1, w: area.w, h: Math.min(formH, area.h - 1) };
  return form(c, state, box);
}
export const formFields = [
  ['objective', 'Objectif', 4],
  ['criteria', 'Critères (1 par ligne)', 3],
  ['constraints', 'Contraintes (option)', 2],
  ['chief', 'Chef', 1],
  ['model', 'Modèle du chef', 1],
  ['mode', 'Mode', 1],
  ['agents', 'Agents max', 1],
  ['submit', '', 1],
] as const;
function form(
  c: Canvas,
  state: State,
  box: Area,
): { x: number; y: number } | null {
  const f = state.form!;
  c.box(box.x, box.y, box.w, box.h, {
    heavy: true,
    style: { fg: 'avt' },
    title: [['Nouvelle session', { fg: 'avt', bold: true }]],
    right: [['Échap annuler', dim]],
  });
  const labelW = 25,
    x = box.x + 2,
    valueX = x + labelW,
    end = box.x + box.w - 2;
  let y = box.y + 1,
    cursor: { x: number; y: number } | null = null;
  formFields.forEach(([id, label, rows], index) => {
    if (y >= box.y + box.h - 2) return;
    const active = f.field === index;
    const labelStyle: Style = active ? { fg: 'cyan', bold: true } : dim;
    if (id === 'submit') {
      const text = f.busy ? ' ◌ Création en cours… ' : ' ▶ Lancer la session ';
      c.text(
        valueX,
        y,
        text,
        active
          ? { fg: 'bg', bg: 'cyan', bold: true }
          : { fg: 'cyan', bold: true },
      );
      y += 1;
      return;
    }
    c.text(x, y, (active ? '▸ ' : '  ') + label, labelStyle, valueX - 1);
    if (id === 'chief' || id === 'mode') {
      const options =
        id === 'chief'
          ? ['défaut', 'Claude Code', 'Codex']
          : ['code', 'documentation'];
      const value = id === 'chief' ? f.chief : f.mode;
      let cx = valueX;
      options.forEach((option, optionIndex) => {
        cx = c.text(
          cx,
          y,
          optionIndex === value ? `‹ ${option} ›` : ` ${option} `,
          optionIndex === value
            ? { fg: active ? 'cyan' : 'text', bold: true }
            : dim,
          end,
        );
      });
      if (active) c.text(cx + 1, y, '←→ choisir', dim, end);
      y += 1;
      return;
    }
    const draft = f.values[id];
    const layout = layoutDraft(draft, Math.max(4, end - valueX));
    const firstRow = Math.max(
      0,
      Math.min(layout.row - rows + 1, layout.rows.length - rows),
    );
    for (let row = 0; row < rows; row++) {
      const text = layout.rows[firstRow + row];
      if (text === undefined) break;
      c.text(
        valueX,
        y + row,
        text,
        { fg: 'text', underline: active },
        end,
        true,
      );
    }
    if (!draft.text)
      c.text(
        valueX,
        y,
        id === 'model' || id === 'agents'
          ? 'vide = configuration'
          : id === 'constraints'
            ? 'aucune'
            : 'à saisir',
        dim,
        end,
      );
    if (active)
      cursor = { x: valueX + layout.col, y: y + layout.row - firstRow };
    y += rows;
  });
  if (f.error) c.text(x, box.y + box.h - 2, `✗ ${f.error}`, { fg: 'red' }, end);
  else
    c.text(
      x,
      box.y + box.h - 2,
      'Les critères sont des preuves observables ; le chef ne peut pas terminer sans elles.',
      dim,
      end,
    );
  return cursor;
}

function card(c: Canvas, area: Area, state: State, data: RunData, crew: Team) {
  const pending = alerts(data, crew, state.dismissed);
  const target = state.target.get(data.id);
  const alert = pending.find((item) => item.key === target) ?? pending[0];
  if (!alert) return 0;
  const width = area.w - 4;
  const compact = state.height < 32;
  const body = wrap(alert.action, width - 9, compact ? 1 : 2);
  const note = compact ? [] : wrap(alert.note, width, 2);
  const h =
    (compact ? 2 : 3) +
    body.length +
    (alert.choices.length ? 1 : 0) +
    note.length;
  if (area.h - h < 6) {
    // Not enough room for the card: keep a visible one-line notice above the input.
    if (area.h < 2) return 0;
    const y = area.y + area.h - 1;
    c.fill(area.x, y, area.w, 1, {});
    c.spans(
      area.x + 1,
      y,
      [
        [
          alert.kind === 'question' ? '? ' : '⚠ ',
          { fg: alert.kind === 'question' ? 'yellow' : 'red', bold: true },
        ],
        [
          alert.title,
          { fg: alert.kind === 'question' ? 'yellow' : 'red', bold: true },
        ],
        [` · ${alert.action}`, { fg: 'text' }],
        [
          alert.kind === 'question' ? ' · Ctrl+T répondre' : ' · Échap masquer',
          dim,
        ],
      ],
      area.x + area.w - 1,
    );
    return 1;
  }
  const top = area.y + area.h - h;
  const tone: Tone = alert.kind === 'question' ? 'yellow' : 'red';
  const answering = target === alert.key;
  c.fill(area.x, top, area.w, h, {});
  c.box(area.x, top, area.w, h, {
    style: { fg: tone },
    heavy: answering,
    title: [
      [alert.kind === 'question' ? '? ' : '⚠ ', { fg: tone, bold: true }],
      [alert.title, { fg: tone, bold: true }],
      [compact ? ` · ${alert.requester} · ${alert.scope}` : '', dim],
      [pending.length > 1 ? `  (+${pending.length - 1})` : '', dim],
    ],
    right: [
      [
        answering
          ? 'saisie liée à cette question · chiffre = option'
          : alert.kind === 'question'
            ? 'Ctrl+T répondre'
            : 'Échap masquer',
        dim,
      ],
    ],
  });
  let y = top + 1;
  if (!compact)
    c.spans(
      area.x + 2,
      y++,
      [
        ['Demandeur : ', dim],
        [alert.requester, bold],
        ['  ·  Portée : ', dim],
        [alert.scope, { fg: 'text' }],
      ],
      area.x + area.w - 2,
    );
  body.forEach((part, index) =>
    c.spans(
      area.x + 2,
      y++,
      [
        [
          index
            ? '         '
            : alert.kind === 'question'
              ? 'Question '
              : 'Action   ',
          dim,
        ],
        [part, { fg: 'text' }],
      ],
      area.x + area.w - 2,
    ),
  );
  if (alert.choices.length)
    c.spans(
      area.x + 2,
      y++,
      [
        ['Choix    ', dim],
        ...alert.choices.map(
          (choice) => [choice + '   ', { fg: 'cyan', bold: true }] as Span,
        ),
      ],
      area.x + area.w - 2,
    );
  note.forEach((part, index) =>
    c.text(area.x + 2, y + index, part, dim, area.x + area.w - 2),
  );
  return h;
}

function input(
  c: Canvas,
  state: State,
  area: Area,
  data: RunData | null,
  crew: Team | null,
) {
  const key = state.current ?? 'new';
  const draft = state.drafts.get(key) ?? { text: '', cursor: 0 };
  const target = state.current
    ? (state.target.get(state.current) ?? 'chief')
    : 'chief';
  let label = 'Chef';
  if (target.startsWith('question:')) label = `réponse à ${target}`;
  else if (target !== 'chief' && crew)
    label = crew.byTask.get(target)?.name ?? target;
  c.box(area.x, area.y, area.w, area.h, {
    style: { fg: draft.text.startsWith('/') ? 'cyan' : 'border' },
    title: [
      [draft.text.startsWith('/') ? 'Commande' : 'Message → ', dim],
      [draft.text.startsWith('/') ? '' : label, { fg: 'cyan', bold: true }],
    ],
    right: [
      [
        data?.run
          ? `${providerLabel(crew?.chief.provider ?? null)} · ${short(state.current, 14)}`
          : '',
        dim,
      ],
    ],
  });
  const width = area.w - 6;
  const layout = layoutDraft(draft, width);
  const rows = area.h - 2;
  const first = Math.max(
    0,
    Math.min(layout.row - rows + 1, layout.rows.length - rows),
  );
  for (let row = 0; row < rows; row++) {
    const text = layout.rows[first + row];
    if (text === undefined) break;
    c.text(area.x + 2, area.y + 1 + row, first + row === 0 ? '› ' : '  ', {
      fg: 'cyan',
    });
    c.text(
      area.x + 4,
      area.y + 1 + row,
      text,
      { fg: 'text' },
      area.x + area.w - 2,
      true,
    );
  }
  if (!draft.text)
    c.text(
      area.x + 4,
      area.y + 1,
      data?.run
        ? `Écrire à ${label}…  ( / pour les commandes )`
        : 'Tapez / pour les commandes',
      dim,
      area.x + area.w - 2,
    );
  return { x: area.x + 4 + layout.col, y: area.y + 1 + layout.row - first };
}

function palette(c: Canvas, state: State, area: Area, data: RunData | null) {
  const draft = state.drafts.get(state.current ?? 'new')?.text ?? '';
  const items = paletteItems(draft, data, state.doctor, viewLabel(state.view));
  const rowsH = Math.max(1, Math.min(items.length, 8));
  const h = Math.min(area.h, rowsH + 4);
  const top = area.y + area.h - h;
  c.fill(area.x, top, area.w, h, {});
  c.box(area.x, top, area.w, h, {
    style: { fg: 'cyan' },
    title: [['Commandes', { fg: 'cyan', bold: true }]],
    right: [
      ['↑↓ choisir · Tab compléter · Entrée exécuter · Échap fermer', dim],
    ],
  });
  if (!items.length) {
    c.text(area.x + 2, top + 1, 'Aucune commande ne correspond.', dim);
    return;
  }
  const index = Math.min(state.paletteIndex, items.length - 1);
  const first = Math.max(0, Math.min(index - rowsH + 1, items.length - rowsH));
  const end = area.x + area.w - 2;
  const nameW = 22,
    labelW = Math.max(18, Math.min(38, Math.floor((area.w - nameW) / 2)));
  items.slice(first, first + rowsH).forEach((item, row) => {
    const y = top + 1 + row;
    const focused = first + row === index;
    const base: Style = focused ? { bg: 'selBg' } : {};
    if (focused) c.fill(area.x + 1, y, area.w - 2, 1, base);
    const muted = item.disabled !== null;
    const x = area.x + 2;
    c.text(x, y, focused ? '▸' : ' ', { ...base, fg: 'cyan' });
    // ⊘ keeps unavailable entries recognisable without colour.
    c.text(
      x + 2,
      y,
      (muted ? '⊘ ' : '') + item.insert,
      { ...base, fg: muted ? 'dim' : 'cyan', bold: !muted },
      Math.min(end, x + nameW),
    );
    c.text(
      x + nameW + 1,
      y,
      item.label,
      { ...base, fg: muted ? 'dim' : 'text' },
      Math.min(end, x + nameW + labelW),
    );
    c.text(
      x + nameW + labelW + 1,
      y,
      muted && !item.value ? 'indisponible' : item.value,
      { ...base, fg: muted ? 'dim' : 'yellow' },
      end,
    );
  });
  const focused = items[index]!;
  const info = top + 1 + rowsH;
  c.spans(
    area.x + 2,
    info,
    [
      ['Cible : ', dim],
      [focused.target, { fg: 'text' }],
      ['   Usage : ', dim],
      [focused.usage, { fg: 'text' }],
    ],
    end,
  );
  c.text(
    area.x + 2,
    info + 1,
    focused.disabled
      ? `⊘ ${focused.disabled}`
      : `Prise d’effet : ${focused.effect || '—'}`,
    { fg: focused.disabled ? 'yellow' : 'dim' },
    end,
  );
}

function overlayBox(c: Canvas, area: Area, title: string) {
  c.fill(area.x, area.y, area.w, area.h, {});
  c.box(area.x, area.y, area.w, area.h, {
    heavy: true,
    style: { fg: 'cyan' },
    title: [[title, { fg: 'cyan', bold: true }]],
    right: [['Échap fermer', dim]],
  });
}
export const HELP: [string, string][] = [
  [
    'Entrée',
    'envoyer la saisie (à la cible affichée) ; saisie vide : agrandir / ouvrir',
  ],
  [
    'Alt+Entrée, Ctrl+J',
    'nouvelle ligne ; un collage multiligne reste un brouillon',
  ],
  ['Tab / Maj+Tab', 'changer de vue : Activité, Carte, Conversation'],
  [
    '↑ ↓ ← →',
    'saisie vide : sélectionner un agent ou défiler ; sinon déplacer le curseur',
  ],
  ['PgPréc PgSuiv Début Fin', 'défiler l’historique sans retour forcé en bas'],
  ['Échap', 'fermer palette, aide, détail ou encart'],
  ['/', 'palette de commandes (saisie vide)'],
  ['Ctrl+T', 'destinataire : chef, agent sélectionné, question ouverte'],
  ['Ctrl+B', 'colonne Sessions (vue séparée sur terminal étroit)'],
  ['Ctrl+P / Ctrl+N', 'session précédente / suivante (brouillons conservés)'],
  ['Ctrl+U / Ctrl+K', 'effacer jusqu’au début / à la fin de la ligne'],
  ['q, :q, /quit, Ctrl+C', 'détacher : le service et les agents continuent'],
  ['', ''],
  [
    'Messages',
    'enregistré → transmis → reçu → prise en compte déclarée (ou échec)',
  ],
  [
    'Livraisons',
    'terminé = compte rendu déclaré · testé = vérifications déclarées · validé = acceptée par le moteur',
  ],
  [
    'États',
    '● en cours · ◌ attente · ✓ réussite · ✗ échec · ■ bloqué · ‖ pause · ⊘ annulé',
  ],
];
function help(c: Canvas, area: Area) {
  overlayBox(c, area, 'Aide et raccourcis');
  const rows: Span[][] = [];
  for (const [key, text] of HELP)
    wrap(text || ' ', Math.max(10, area.w - 30)).forEach((part, index) =>
      rows.push([
        [(index ? '' : key).padEnd(24), { fg: 'cyan', bold: true }],
        [part, { fg: 'text' }],
      ]),
    );
  rows
    .slice(0, area.h - 2)
    .forEach((spans, index) =>
      c.spans(area.x + 2, area.y + 1 + index, spans, area.x + area.w - 2),
    );
}
function agentsTable(c: Canvas, state: State, area: Area, crew: Team) {
  overlayBox(c, area, `Équipe · ${crew.agents.length} agent(s) + chef`);
  const end = area.x + area.w - 2;
  c.text(
    area.x + 2,
    area.y + 1,
    'Nom          Rôle            Fournisseur   Modèle        Session native        État',
    dim,
    end,
  );
  crew.all.slice(0, area.h - 3).forEach((person, index) => {
    const y = area.y + 2 + index;
    const focused = index === state.agentsIndex;
    if (focused) c.fill(area.x + 1, y, area.w - 2, 1, { bg: 'selBg' });
    const base: Style = focused ? { bg: 'selBg' } : {};
    const cells: [string, number][] = [
      [person.name, 13],
      [person.role, 16],
      [providerLabel(person.provider), 14],
      [person.model ?? 'défaut', 14],
      [person.native ?? 'indisponible', 22],
    ];
    let x = area.x + 2;
    for (const [value, size] of cells) {
      c.text(x, y, value, { ...base, fg: 'text' }, Math.min(end, x + size - 1));
      x += size;
    }
    const [symbol, tone] = stateMark(person.status);
    c.text(
      x,
      y,
      `${symbol} ${stateLabel(person.status)}`,
      { ...base, fg: tone },
      end,
    );
  });
  c.text(
    area.x + 2,
    area.y + area.h - 1,
    ' Entrée : détails · ↑↓ choisir ',
    dim,
  );
}
function confirm(c: Canvas, area: Area, text: string) {
  const w = Math.min(area.w, Math.max(40, textWidth(text) + 6));
  const box = {
    x: area.x + Math.floor((area.w - w) / 2),
    y: area.y + Math.floor(area.h / 2) - 2,
    w,
    h: 5,
  };
  overlayBox(c, box, 'Confirmation');
  c.text(box.x + 2, box.y + 1, text, { fg: 'text' }, box.x + box.w - 2);
  c.spans(box.x + 2, box.y + 3, [
    ['Entrée', { fg: 'cyan', bold: true }],
    [' confirmer   ', dim],
    ['Échap', { fg: 'cyan', bold: true }],
    [' annuler', dim],
  ]);
}

function footer(c: Canvas, state: State, y: number) {
  c.fill(0, y, c.width, 1, { bg: 'raised' });
  const draft = state.drafts.get(state.current ?? 'new')?.text ?? '';
  const keys: [string, string][] = state.form
    ? [
        ['Tab', 'champ'],
        ['Entrée', 'suivant'],
        ['Alt+Entrée', 'ligne'],
        ['←→', 'choix'],
        ['Échap', 'annuler'],
        ['Ctrl+C', 'quitter'],
      ]
    : state.confirm
      ? [
          ['Entrée', 'confirmer'],
          ['Échap', 'annuler'],
        ]
      : draft
        ? [
            ['Entrée', draft.startsWith('/') ? 'exécuter' : 'envoyer'],
            ['Alt+Entrée', 'ligne'],
            ['Ctrl+T', 'cible'],
            ['Échap', 'fermer'],
            ['Ctrl+C', 'détacher'],
          ]
        : [
            ['Entrée', 'agrandir'],
            ['↑↓←→', 'sélection'],
            ['Tab', 'vue'],
            ['/', 'commandes'],
            ['Ctrl+T', 'cible'],
            ['Ctrl+B', 'sessions'],
            ['Ctrl+P/N', 'session'],
            ['PgPréc', 'historique'],
            ['/help', 'aide'],
            ['q', 'détacher'],
          ];
  let x = 1;
  for (const [key, label] of keys) {
    if (x + textWidth(key + label) + 3 > c.width - 1) break;
    x = c.text(x, y, key, { fg: 'cyan', bg: 'raised', bold: true });
    x = c.text(x, y, ` ${label}   `, { fg: 'dim', bg: 'raised' });
  }
}

/** Whole-screen frame; pure apart from scroll anchoring stored in the state. */
export function renderFrame(
  state: State,
  width: number,
  height: number,
): Frame {
  state.width = width;
  state.height = height;
  const c = new Canvas(width, height);
  const data = state.current ? (state.data.get(state.current) ?? null) : null;
  const crew = data?.run ? team(data) : null;
  if (width < 44 || height < 12) {
    c.spans(0, 0, [...SIGNATURE, [' Avity Crew', bold]]);
    c.text(0, 1, `Terminal trop petit (${width}×${height}) : 44×12 minimum.`, {
      fg: 'yellow',
    });
    c.text(0, 2, 'Le brouillon et la session sont conservés.', dim);
    const draft = state.drafts.get(state.current ?? 'new') ?? {
      text: '',
      cursor: 0,
    };
    const layout = layoutDraft(draft, Math.max(1, width - 2));
    c.text(0, height - 1, '› ', { fg: 'cyan' });
    c.text(2, height - 1, layout.rows[layout.row] ?? '', {}, width, true);
    return {
      lines: c.lines(),
      plain: c.plain(),
      cursor: { x: Math.min(width - 1, 2 + layout.col), y: height - 1 },
    };
  }
  header(c, state, data, crew);
  const footerY = height - 1;
  footer(c, state, footerY);
  let bottom = footerY;
  let cursor: { x: number; y: number } | null = null;
  const wide = width >= 110;
  const sidebar = wide && state.sidebar;
  const mainX = sidebar ? 30 : 0;
  const main = (top: number, bottomY: number): Area => ({
    x: mainX,
    y: top,
    w: width - mainX,
    h: bottomY - top,
  });
  if (!state.form && (data?.run || state.current)) {
    const draft = state.drafts.get(state.current ?? 'new') ?? {
      text: '',
      cursor: 0,
    };
    const lines = Math.min(
      6,
      layoutDraft(draft, width - mainX - 6).rows.length,
    );
    const inputArea = {
      x: mainX,
      y: bottom - lines - 2,
      w: width - mainX,
      h: lines + 2,
    };
    cursor = input(c, state, inputArea, data, crew);
    bottom = inputArea.y;
    if (state.notice && state.notice.until > state.now) {
      bottom -= 1;
      c.text(
        mainX + 1,
        bottom,
        state.notice.text,
        { fg: state.notice.tone },
        width - 1,
      );
    }
    if (data?.run && crew) {
      const used = card(c, main(2, bottom), state, data, crew);
      bottom -= used;
    }
  } else if (state.notice && state.notice.until > state.now) {
    bottom -= 1;
    c.text(1, bottom, state.notice.text, { fg: state.notice.tone }, width - 1);
  }
  if (sidebar)
    sessionsList(
      c,
      state,
      { x: 0, y: 2, w: 29, h: footerY - 2 },
      null,
      'Sessions',
    );
  const body = main(2, bottom);
  if (state.form || !state.current) {
    const formCursor = home(c, state, body);
    if (state.form) cursor = formCursor;
  } else if (!data?.loaded) {
    c.text(body.x + 2, body.y + 1, '◌ Chargement de la session…', {
      fg: 'yellow',
    });
  } else if (!data.run || !crew) {
    c.text(
      body.x + 2,
      body.y + 1,
      'Session introuvable dans l’état du service.',
      { fg: 'red' },
    );
  } else {
    const expanded = state.expanded.get(data.id);
    const person = expanded
      ? crew.all.find((item) => item.key === expanded)
      : undefined;
    if (person) detail(c, state, body, data, crew, person);
    else if (state.view === 'carte') mapView(c, state, body, data, crew);
    else if (state.view === 'conversation')
      conversationView(c, state, body, data, crew);
    else activityView(c, state, body, data, crew);
    if (state.overlay === 'agents') agentsTable(c, state, body, crew);
  }
  if (state.overlay === 'help') help(c, body);
  if (state.overlay === 'sessions')
    sessionsList(
      c,
      state,
      { x: body.x, y: body.y, w: body.w < 100 ? body.w : 72, h: body.h },
      state.sessionsIndex,
      'Sessions · objectifs',
    );
  const draftText = state.drafts.get(state.current ?? 'new')?.text ?? '';
  if (!state.form && draftText.startsWith('/') && !state.overlay)
    palette(c, state, body, data);
  if (state.confirm) confirm(c, body, state.confirm.text);
  if (state.overlay || state.confirm) cursor = null;
  return { lines: c.lines(), plain: c.plain(), cursor };
}
