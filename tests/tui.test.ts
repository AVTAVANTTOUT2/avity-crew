import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runArguments, parseCli } from '../apps/cli/src/args.ts';
import {
  Controller,
  createState,
  erase,
  insert,
  move,
  vertical,
} from '../apps/cli/src/tui/app.ts';
import type { Io, Key, State } from '../apps/cli/src/tui/app.ts';
import {
  applyExport,
  applyStatus,
  applyTeam,
  toolStep,
} from '../apps/cli/src/tui/model.ts';
import { LOGO, renderFrame } from '../apps/cli/src/tui/render.ts';
import { textWidth } from '../apps/cli/src/tui/term.ts';
import { scenario } from './fixtures/tui/scenario.ts';

/** Every scenario is explicitly simulated: these tests prove rendering and routing only. */
function loaded(agents: number, now?: number): State {
  const fake = scenario(agents, now);
  const state = createState('/projets/factures', 'run:demo');
  const data = state.data.get('run:demo')!;
  applyStatus(data, fake.status);
  applyTeam(data, fake.team);
  applyExport(data, fake.report);
  state.runs = [
    { id: 'run:demo', objective: 'Export CSV', status: 'running' },
    { id: 'run:other', objective: 'Guide', status: 'paused' },
  ];
  state.connection = 'connecté';
  state.now = fake.now;
  return state;
}
const frame = (state: State, width: number, height: number) => {
  const result = renderFrame(state, width, height);
  for (const line of result.plain)
    assert.ok(textWidth(line) <= width, `line wider than ${width}: ${line}`);
  assert.equal(result.lines.length, height);
  return result.plain.join('\n');
};
function fakeIo(agents = 3) {
  const fake = scenario(agents);
  const calls: [string, Record<string, unknown>][] = [];
  const io: Io = {
    admin: async (method, args) => {
      calls.push([method, args]);
      if (method === 'status') return fake.status;
      if (method === 'list_runs')
        return [
          { id: 'run:demo', status: 'running' },
          { id: 'run:other', status: 'paused' },
        ];
      if (method === 'export') return fake.report;
      if (method === 'create_run') return { id: 'run:new', status: 'running' };
      return { status: 'paused' };
    },
    execute: async (call) => {
      calls.push(['execute', { method: call.method }]);
      return fake.team;
    },
    send: async (runId, content, to) => {
      calls.push(['send', { runId, content, to }]);
      return {
        result: {
          result: {
            id: 'message:new',
            status: 'queued',
            created_at: new Date(fake.now).toISOString(),
          },
        },
      };
    },
  };
  return { io, calls };
}
const press = async (controller: Controller, sequence: (string | Key)[]) => {
  for (const item of sequence)
    if (typeof item === 'string')
      for (const char of item) await controller.key(char, {});
    else await controller.key(undefined, item);
};

test('home shows the red AVT emblem and the session form; small terminals keep a signature', () => {
  const state = createState('/projets/factures', null);
  new Controller(state, fakeIo().io, () => {}, true);
  const wide = frame(state, 150, 40);
  for (const row of LOGO.slice(7, 12))
    assert.ok(wide.includes(row.trim().slice(0, 12)));
  assert.match(wide, /Nouvelle session/);
  assert.match(wide, /Lancer la session/);
  assert.match(frame(state, 60, 20), /◜AVT◞ Avity Crew/);
  assert.match(frame(state, 30, 8), /Terminal trop petit/);
});

test('activity mosaic follows the real team size, width and selection', () => {
  assert.match(frame(loaded(0), 120, 30), /Aucun agent pour l’instant/);
  for (const agents of [1, 2, 6, 12]) {
    const state = loaded(agents);
    state.select.set('run:demo', 1);
    const wide = frame(state, 160, 48);
    assert.match(
      wide,
      /┏ ◆ dev-1 · développeur/,
      'selected panel has a heavy border',
    );
    assert.match(wide, /Chef · orchestrateur/);
    if (agents >= 2)
      assert.match(wide, /[╮┓][╭┏]/, 'two columns on a wide terminal');
    if (agents === 12)
      assert.match(wide, /↓ \d+ en dessous — ↑↓ pour parcourir/);
    assert.ok(!/[╮┓][╭┏]/.test(frame(state, 80, 24)), 'one column when narrow');
  }
  const view = frame(loaded(6), 160, 48);
  assert.match(view, /Claude Code/);
  assert.match(view, /Codex/);
  assert.match(view, /▸ exec npm run lint/);
  assert.match(view, /✗ code 1/);
  assert.match(view, /✓ terminé {2}✓ testé {2}◌ validé/);
  assert.ok(!view.includes('%'), 'no invented percentage');
  assert.ok(!view.includes('INJECTED') && !view.includes('\u001b]52'));
});

test('Enter enlarges the selected agent with pinned identity, diff markers and history; Escape returns', async () => {
  const state = loaded(6);
  const controller = new Controller(state, fakeIo().io);
  await press(controller, [{ name: 'right' }, { name: 'return' }]);
  const detail = frame(state, 120, 48);
  assert.match(detail, /dev-1 · développeur · Claude Code/);
  assert.match(detail, /session native native-1-4f9b2c/);
  assert.match(detail, /Historique observé/);
  assert.match(detail, /- const rate = 200;/);
  assert.match(detail, /\+ const rate = 60;/);
  assert.match(
    detail,
    /testé : 2\/2 vérifications déclarées réussies \(live\)/,
  );
  await press(controller, [{ name: 'escape' }]);
  assert.equal(state.expanded.get('run:demo'), null);
});

test('map places the chief among agents, falls back to a tree and journals real exchanges only', () => {
  const recent = loaded(6);
  const radial = frame(((recent.view = 'carte'), recent), 160, 44);
  assert.match(radial, /◆ Chef/);
  assert.match(radial, /relecture-1/);
  assert.match(radial, /•·*●|●/, 'marker for the message recorded 4 s ago');
  assert.match(
    radial,
    /\[transmis\] correction : Ajoute le cas d’accès refusé/,
  );
  assert.match(
    radial,
    /\[enregistré\] information : Le contrat de t1 est publié/,
  );
  const later = loaded(6, Date.parse('2026-10-25T10:00:00Z'));
  later.now += 120_000;
  later.view = 'carte';
  const quiet = renderFrame(later, 160, 44).plain.slice(2, 26).join('\n');
  assert.ok(!quiet.includes('•'), 'no marker without a recent exchange');
  const small = loaded(6);
  small.view = 'carte';
  const tree = frame(small, 80, 30);
  assert.match(tree, /├─ dev-1 · développeur · Claude Code/);
  assert.match(tree, /dépend de dev-1/);
});

test('conversation keeps the reading position when history grows', () => {
  const state = loaded(3);
  state.view = 'conversation';
  frame(state, 100, 24);
  state.scroll.set('run:demo:conversation', 3);
  const data = state.data.get('run:demo')!;
  applyStatus(data, {
    ...scenario(3).status,
    events: [
      {
        seq: data.cursor + 1,
        type: 'provider.text',
        session_id: 'chief:s1',
        occurred_at: new Date(scenario(3).now).toISOString(),
        payload: {
          text: 'Nouvelle réponse\nsur deux lignes',
          provenance: 'live',
        },
      },
    ],
  });
  const view = frame(state, 100, 24);
  assert.ok((state.scroll.get('run:demo:conversation') ?? 0) > 3);
  assert.match(view, /plus récentes · Fin pour revenir/);
});

test('slash palette shows targets and explains unsupported settings', async () => {
  const state = loaded(2);
  const { io, calls } = fakeIo(2);
  const controller = new Controller(state, io);
  await press(controller, ['/']);
  const palette = frame(state, 120, 40);
  assert.match(palette, /\/provider\s+Fournisseur du chef\s+Codex/);
  assert.match(palette, /⊘ \/effort\s+Puissance/);
  assert.match(palette, /Cible : Chef de la session/);
  await press(controller, ['effort', { name: 'return' }]);
  assert.match(state.notice?.text ?? '', /Non pris en charge/);
  await press(controller, [{ name: 'escape' }]);
  await press(controller, [
    '/provider',
    { name: 'tab' },
    'claude',
    { name: 'return' },
  ]);
  assert.match(
    state.confirm?.text ?? '',
    /Remplacer le chef Codex par Claude Code/,
  );
  await press(controller, [{ name: 'escape' }]);
  assert.equal(
    calls.filter(([method]) => method === 'replace_chief').length,
    0,
  );
});

test('drafts survive view and session switches; a sent message stays "enregistré" until observed', async () => {
  const state = loaded(3);
  const { io, calls } = fakeIo(3);
  const controller = new Controller(state, io);
  await press(controller, ['brouillon é🧪', { name: 'enter' }, 'ligne 2']);
  await press(controller, [{ name: 'n', ctrl: true }]);
  assert.equal(state.current, 'run:other');
  await press(controller, ['autre']);
  await press(controller, [{ name: 'p', ctrl: true }, { name: 'tab' }]);
  assert.equal(state.view, 'carte');
  assert.equal(controller.draft().text, 'brouillon é🧪\nligne 2');
  assert.equal(state.drafts.get('run:other')?.text, 'autre');
  await press(controller, [{ name: 'return' }]);
  assert.deepEqual(calls.find(([method]) => method === 'send')?.[1], {
    runId: 'run:demo',
    content: 'brouillon é🧪\nligne 2',
    to: 'chief',
  });
  assert.equal(controller.draft().text, '');
  state.view = 'conversation';
  assert.match(frame(state, 100, 30), /Vous → Chef · message · enregistré/);
});

test('questions are answered through their own id; permission refusals offer no approval', async () => {
  const state = loaded(3);
  const { io, calls } = fakeIo(3);
  const controller = new Controller(state, io);
  const card = frame(state, 120, 40);
  assert.match(card, /Question bloquante du chef/);
  assert.match(card, /1 Oui {3}2 Non/);
  await press(controller, [{ name: 't', ctrl: true }]);
  assert.equal(state.target.get('run:demo'), 'question:question:q1');
  await press(controller, ['1', { name: 'return' }]);
  assert.deepEqual(calls.find(([method]) => method === 'answer')?.[1], {
    run_id: 'run:demo',
    question_id: 'question:q1',
    answer: 'Oui',
  });
  const data = state.data.get('run:demo')!;
  data.questions = [];
  const permission = frame(state, 120, 40);
  assert.match(permission, /Permission refusée par le fournisseur/);
  assert.match(permission, /Bash \(npm publish\)/);
  assert.match(permission, /n’expose aucune approbation/);
  assert.ok(!/Oui, ne plus demander|don't ask/i.test(permission));
  await press(controller, [{ name: 'escape' }]);
  assert.ok(
    !frame(state, 120, 40).includes('Permission refusée par le fournisseur'),
  );
});

test('new-session form validates like `run` and sends the same create_run arguments', async () => {
  const state = createState('/projets/factures', null);
  const { io, calls } = fakeIo(1);
  const controller = new Controller(state, io, () => {}, true);
  await press(controller, [
    'Objectif é🧪',
    { name: 'enter' },
    'ligne 2',
    { name: 'return' },
  ]);
  for (let index = 0; index < 7; index++)
    await press(controller, [{ name: 'return' }]);
  assert.match(state.form?.error ?? '', /critère/);
  assert.equal(state.form?.field, 1);
  await press(controller, ['Critère observable']);
  for (let index = 0; index < 6; index++)
    await press(controller, [{ name: 'tab' }]);
  await press(controller, [{ name: 'return' }]);
  const created = calls.find(([method]) => method === 'create_run')?.[1];
  assert.deepEqual(
    created,
    runArguments(
      parseCli([
        'run',
        '--criterion',
        'Critère observable',
        '--mode',
        'code',
        '--',
        'Objectif é🧪\nligne 2',
      ]),
      'Objectif é🧪\nligne 2',
    ),
  );
  assert.equal(state.current, 'run:new');
  assert.equal(state.form, null);
});

test('editor moves by graphemes and lines; tool events become readable actions', () => {
  const draft = { text: '', cursor: 0 };
  insert(draft, 'a🧪é\nxyz');
  move(draft, -1);
  erase(draft, -1);
  assert.equal(draft.text, 'a🧪é\nxz');
  assert.ok(vertical(draft, -1));
  erase(draft, -1);
  assert.equal(draft.text, '🧪é\nxz');
  assert.equal(vertical(draft, -1), false);
  assert.deepEqual(
    toolStep(
      'command_execution item_1 (completed)\nnpm test\nexit_code: 0\n15 passed',
      null,
    ).lines.map((line) => [line.kind, line.text]),
    [
      ['run', 'npm test'],
      ['ok', 'code 0 · 15 passed'],
    ],
  );
  assert.deepEqual(
    toolStep(
      'file_change item_2 (completed)\n[{"path":"a.ts","kind":"delete"}]',
      null,
    ).lines[0],
    { kind: 'del', text: 'a.ts (diff non fourni par Codex)', at: null },
  );
});
