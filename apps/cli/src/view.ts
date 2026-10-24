import { createInterface } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { CrewError } from '../../../packages/contracts/src/index.ts';
import { redactContext } from '../../../packages/context/src/index.ts';
import type { SupervisorClient } from '../../../packages/supervisor/src/client.ts';
import type { CliCommand } from './args.ts';

export function cleanText(value: string, multiline = false): string {
  let text = redactContext(stripVTControlCharacters(value));
  const token = process.env.AVITY_CREW_CAPABILITY;
  if (token) text = text.replaceAll(token, '[MASQUÉ]');
  return text.replace(
    multiline
      ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
      : /[\u0000-\u001f\u007f-\u009f]/g,
    ' ',
  );
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const items = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : 'indisponible';
const states: Record<string, string> = {
  planning: 'planification',
  running: 'en cours',
  queued: 'en file',
  ready: 'prête',
  waiting_dependency: 'attente dépendance',
  waiting_user: 'attente utilisateur',
  waiting_provider: 'attente fournisseur',
  paused: 'en pause',
  validating: 'validation',
  in_review: 'en revue',
  accepted: 'acceptée',
  completed: 'terminé',
  failed: 'échec',
  cancelled: 'annulé',
  blocked: 'bloquée',
  interrupted: 'interrompue',
};
export function clipLine(value: string, width: number): string {
  const limit = Math.max(1, width);
  const parts: { text: string; width: number }[] = [];
  let used = 0;
  for (const { segment } of new Intl.Segmenter('fr', {
    granularity: 'grapheme',
  }).segment(cleanText(value))) {
    const columns =
      /[\p{Extended_Pictographic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
        segment,
      )
        ? 2
        : 1;
    if (used + columns > limit) {
      while (used >= limit && parts.length) used -= parts.pop()!.width;
      return parts.map((part) => part.text).join('') + '…';
    }
    parts.push({ text: segment, width: columns });
    used += columns;
  }
  return parts.map((part) => part.text).join('');
}
export function renderSnapshot(
  snapshot: unknown,
  width = 100,
  height = 40,
): string {
  width = Math.max(1, width);
  const data = record(snapshot),
    run = record(data.run),
    tasks = items(data.tasks),
    sessions = items(data.sessions),
    questions = items(data.questions),
    contexts = items(data.contexts);
  const activity = record(data.activity);
  const activeTurns = Array.isArray(activity.active)
    ? items(activity.active).filter((turn) => turn.run_id === run.id).length
    : null;
  const queuedTurns = Array.isArray(activity.queued)
    ? items(activity.queued).filter((turn) => turn.run_id === run.id).length
    : null;
  const conversation = items(data.viewer_messages ?? data.events).filter(
    (event) =>
      event.type === 'provider.text' &&
      typeof record(event.payload).text === 'string',
  );
  const usageEvent =
    data.viewer_usage ??
    items(data.events)
      .filter((event) => event.type === 'provider.usage')
      .at(-1)?.payload;
  const usage = record(record(usageEvent).usage);
  const liveUsage =
    record(usageEvent).provenance === 'live' &&
    (typeof usage.input_tokens === 'number' ||
      typeof usage.output_tokens === 'number');
  const lines = [
    'Avity Crew — état observé du projet',
    `Projet : ${text(record(data.project).root ?? record(data.project).id)}`,
    `État : ${states[text(run.status)] ?? text(run.status)}`,
    `Objectif : ${text(run.id)}`,
    text(run.objective),
    `Tâches : ${tasks.length} | Sessions connues : ${sessions.length} | Capacité configurée : ${text(run.max_active_agents)}`,
    `Tours actifs : ${text(activeTurns)} | Tours en file : ${text(queuedTurns)} (distincts des sessions et tâches)`,
  ];
  if (conversation.length) {
    lines.push('Conversation :');
    for (const event of conversation.slice(-2)) {
      const payload = record(event.payload);
      lines.push(
        `#${text(event.seq)} ${text(event.session_id ?? event.actor_id)}${payload.provenance === 'simulated' ? ' (simulation)' : ''}`,
      );
      const message = cleanText(String(payload.text), true).replaceAll(
        '\t',
        '    ',
      );
      const parts = [
        ...new Intl.Segmenter('fr', { granularity: 'grapheme' }).segment(
          message,
        ),
      ].map((part) => part.segment);
      let line = '',
        columns = 0,
        displayed = 0;
      for (const part of parts) {
        const size =
          /[\p{Extended_Pictographic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
            part,
          )
            ? 2
            : 1;
        if (part === '\n' || columns + size > width) {
          lines.push(line);
          line = '';
          columns = 0;
          if (++displayed === 3) break;
        }
        if (part !== '\n') {
          line += part;
          columns += size;
        }
      }
      if (line) lines.push(line);
      if (displayed === 3)
        lines.push('Message résumé ; texte complet dans export.');
    }
  }
  lines.push('Tâches / attentes :');
  for (const task of tasks.slice(0, 12))
    lines.push(
      `${text(task.id)} [${states[text(task.status)] ?? text(task.status)}] ${text(record(task.spec).title)}${task.wait_reason ? ' — ' + text(task.wait_reason) : ''}`,
    );
  if (tasks.length > 12)
    lines.push(
      `${tasks.length - 12} autres tâches : consulter status --json ou export.`,
    );
  lines.push('Équipe :');
  for (const session of sessions.slice(-7))
    lines.push(
      `${text(session.id)} | ${text(session.provider)} | modèle ${text(session.model)} | tâche ${text(session.task_id)}`,
    );
  const estimates = contexts
    .map((context) => record(context.budget))
    .filter((budget) => typeof budget.estimated_input_tokens === 'number');
  lines.push(
    `Contexte : ${
      estimates.length
        ? estimates
            .map(
              (budget) =>
                `${budget.estimated_input_tokens} tokens estimés (${text(budget.measurement)})`,
            )
            .slice(-2)
            .join(' ; ')
        : 'estimation indisponible'
    } ; ${liveUsage ? `usage déclaré du dernier tour : entrée ${text(usage.input_tokens)}, sortie ${text(usage.output_tokens)}` : 'usage réel : indisponible'}.`,
  );
  lines.push(
    `Questions : ${questions.length} | Décisions : ${items(data.decisions).length} | Vérifications : ${items(data.verifications).length}`,
  );
  for (const question of questions.slice(-3))
    lines.push(
      `Question ${text(question.id ?? question.question_id)} : ${text(question.question ?? question.content)}`,
    );
  for (const blocker of Array.isArray(data.blockers)
    ? data.blockers.slice(-3)
    : [])
    lines.push(
      'Blocage : ' +
        (typeof blocker === 'string' ? blocker : JSON.stringify(blocker)),
    );
  lines.push('Événements nouveaux :');
  for (const event of items(data.events)
    .filter((event) => event.type !== 'provider.text')
    .slice(-6))
    lines.push(
      `#${text(event.seq)} ${text(event.type)} ${JSON.stringify(event.payload ?? {})}`,
    );
  if (items(data.events).length > 6)
    lines.push(
      `${items(data.events).length - 6} événements résumés hors écran ; status --after-seq ${text(data.viewer_after_seq ?? 0)} --limit 100 --json pour la page complète.`,
    );
  lines.push(
    'Contexte/preuves : inspect-context --run ID --subject ID ; export --run ID.',
    'Messages : queued = enregistré, delivered = transmis, acknowledged = reçu, applied = prise en compte déclarée.',
  );
  const available = Math.max(1, height - 1);
  return lines
    .slice(0, available)
    .map((line) => clipLine(line, width))
    .join('\n');
}
export function runExit(snapshot: unknown): number {
  const status = record(record(snapshot).run).status;
  return status === 'completed'
    ? 0
    : status === 'failed'
      ? 1
      : status === 'cancelled'
        ? 130
        : status === 'waiting_user'
          ? 5
          : 4;
}
export interface WatchActions {
  answer(questionId: string, answer: string, runId: string): Promise<unknown>;
  message(content: string, runId: string): Promise<unknown>;
}
export async function watchRun(
  client: SupervisorClient,
  command: CliCommand,
  actions: WatchActions,
): Promise<number> {
  let cursor = command.afterSeq,
    last: unknown = null,
    done = false,
    interrupted = false,
    busy = false;
  let activeRun = command.run;
  const conversation = new Map<number, Record<string, unknown>>();
  let latestUsage: unknown = null;
  const started = Date.now();
  const interactive = Boolean(
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    !command.json &&
    !command.once,
  );
  const rl = interactive
    ? createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        prompt: 'crew> ',
      })
    : undefined;
  let compose: string[] | null = null;
  const notify = (value: unknown): void => {
    process.stdout.write(
      command.json
        ? JSON.stringify({ schema_version: 1, ok: true, data: value }) + '\n'
        : cleanText(
            typeof value === 'string' ? value : JSON.stringify(value),
            true,
          ) + '\n',
    );
  };
  const render = (): void => {
    if (!last || busy || (rl && (rl.line.length > 0 || compose))) return;
    if (interactive) process.stdout.write('\u001b[2J\u001b[H');
    if (command.json) notify(last);
    else
      process.stdout.write(
        renderSnapshot(
          interactive
            ? {
                ...record(last),
                viewer_messages: [...conversation.values()],
                viewer_usage: latestUsage,
              }
            : last,
          process.stdout.columns ?? 100,
          interactive ? Math.max(5, (process.stdout.rows ?? 30) - 3) : 100,
        ) + '\n',
      );
    if (rl) {
      process.stdout.write(
        'q : détacher ; texte : message chef ; /compose puis . : multiligne ; /answer ID texte\n',
      );
      rl.prompt(true);
    }
    for (const event of items(record(last).events))
      if (typeof event.seq === 'number') cursor = Math.max(cursor, event.seq);
  };
  const stopView = (): void => {
    interrupted = true;
    done = true;
    rl?.close();
  };
  const resized = (): void => render();
  process.on('SIGINT', stopView);
  process.stdout.on('resize', resized);
  rl?.on('SIGINT', stopView);
  rl?.on('close', () => {
    done = true;
  });
  let pending = Promise.resolve();
  rl?.on('line', (line) => {
    pending = pending.then(async () => {
      if (['q', ':q', '/quit'].includes(line.trim())) {
        done = true;
        rl.close();
        return;
      }
      if (line.trim() === '/compose' && !compose) {
        compose = [];
        process.stdout.write(
          'Message multiligne : . termine, /cancel annule.\n',
        );
        rl.prompt();
        return;
      }
      if (compose) {
        if (line === '/cancel') {
          compose = null;
          render();
          return;
        }
        if (line !== '.') {
          compose.push(line);
          rl.prompt();
          return;
        }
        line = compose.join('\n');
        compose = null;
      }
      if (!line.trim()) {
        render();
        return;
      }
      busy = true;
      try {
        const runId = activeRun ?? text(record(record(last).run).id);
        if (line.startsWith('/answer ')) {
          const match = /^\/answer\s+(\S+)\s+([\s\S]+)$/.exec(line);
          if (!match)
            throw new CrewError('CLI_USAGE', '/answer ID réponse attendus.');
          notify(await actions.answer(match[1]!, match[2]!, runId));
        } else notify(await actions.message(line, runId));
      } catch (failure) {
        notify(
          failure instanceof CrewError
            ? `${failure.code} : ${failure.message}`
            : 'Commande non exécutée.',
        );
      } finally {
        busy = false;
        render();
      }
    });
  });
  try {
    while (!done) {
      try {
        const snapshot = await client.admin({
          method: 'status',
          arguments: {
            ...(activeRun ? { run_id: activeRun } : {}),
            after_seq: cursor,
            limit: command.limit,
          },
        });
        const data = record(snapshot);
        const observedRun = record(data.run).id;
        if (!activeRun && typeof observedRun === 'string')
          activeRun = observedRun;
        const fresh = items(data.events).filter(
          (event) => typeof event.seq === 'number' && event.seq > cursor,
        );
        for (const event of fresh) {
          if (event.type === 'provider.text')
            conversation.set(Number(event.seq), event);
          if (event.type === 'provider.usage') latestUsage = event.payload;
        }
        while (conversation.size > 20)
          conversation.delete(conversation.keys().next().value!);
        last = { ...data, events: fresh, viewer_after_seq: cursor };
        render();
        const state = runExit(last);
        if (
          command.once ||
          !data.run ||
          (!interactive && [0, 1, 130].includes(state))
        )
          return state;
      } catch (failure) {
        if (
          !(failure instanceof CrewError) ||
          failure.code !== 'SUPERVISOR_UNAVAILABLE'
        )
          throw failure;
        if (!rl?.line && !compose)
          if (command.json)
            process.stdout.write(
              JSON.stringify({
                schema_version: 1,
                ok: false,
                error: {
                  code: 'SUPERVISOR_UNAVAILABLE',
                  message:
                    'Service indisponible ; reconnexion en cours. Aucun nouveau run créé.',
                  retrying: !command.once,
                },
              }) + '\n',
            );
          else
            notify(
              'Service indisponible ; reconnexion en cours. Aucun nouveau run créé.',
            );
        if (command.once) return 3;
      }
      if (command.timeout && Date.now() - started >= command.timeout)
        return last ? runExit(last) : 3;
      await delay(500);
    }
    await pending;
    return interrupted ? 130 : last ? runExit(last) : 4;
  } finally {
    done = true;
    rl?.close();
    process.off('SIGINT', stopView);
    process.stdout.off('resize', resized);
  }
}
