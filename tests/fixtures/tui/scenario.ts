/** Deterministic fake engine records for terminal rendering tests (explicitly simulated). */
export function scenario(
  agents: number,
  now = Date.parse('2026-10-25T10:00:00Z'),
) {
  const at = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  const roles = [
    'developer',
    'reviewer',
    'developer',
    'documenter',
    'validator',
    'investigator',
    'developer',
    'refactorer',
  ];
  const tasks = Array.from({ length: agents }, (_, index) => ({
    id: `task:t${index + 1}`,
    status: [
      'running',
      'waiting_dependency',
      'accepted',
      'blocked',
      'in_review',
      'running',
      'failed',
      'ready',
    ][index % 8],
    wait_reason: index % 8 === 1 ? 'Attend le contrat de t1' : null,
    spec: {
      title: [
        'Export CSV des factures',
        'Relire l’export',
        'Tests d’accès refusé',
        'Guide utilisateur',
        'Recette combinée',
        'Analyse des lenteurs',
        'Migration du schéma',
        'Nettoyage du module',
      ][index % 8],
      objective: 'Livrer la partie demandée avec preuves observables.',
      role: roles[index % roles.length],
      depends_on: index === 1 ? ['task:t1'] : [],
      acceptance_criteria: [{ description: 'Les tests ciblés passent' }],
    },
  }));
  const sessions = [
    {
      id: 'chief:s1',
      task_id: null,
      provider: 'codex',
      model: 'gpt-5.1',
      native_session_id: '019a7c1e-5d2f-7d10-b7a1-a0f3',
      cli_version: '0.163.0',
    },
    ...tasks.map((task, index) => ({
      id: `session:${index + 1}`,
      task_id: task.id,
      provider: index % 2 ? 'codex' : 'claude',
      model: null,
      native_session_id: index === 3 ? null : `native-${index + 1}-4f9b2c`,
      cli_version: index % 2 ? '0.163.0' : '2.1.4',
    })),
  ];
  let seq = 0;
  const event = (
    type: string,
    ago: number,
    payload: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) => ({
    schema_version: 1,
    id: `event:${++seq}`,
    seq,
    type,
    project_id: 'project:x',
    run_id: 'run:demo',
    task_id: null,
    session_id: null,
    attempt_id: null,
    generation: 1,
    actor_id: 'user:local',
    occurred_at: at(ago),
    payload,
    ...extra,
  });
  const events: Record<string, unknown>[] = [
    event('run.created', 600, { request_key: 'k', subject_id: 'run:demo' }),
    event(
      'provider.session',
      590,
      {
        type: 'session',
        native_session_id: '019a7c1e-5d2f-7d10-b7a1-a0f3',
        provenance: 'live',
      },
      { session_id: 'chief:s1' },
    ),
    event(
      'provider.text',
      580,
      {
        type: 'text',
        text: 'Je découpe l’objectif en missions : export, relecture, tests et documentation.',
        provenance: 'live',
      },
      { session_id: 'chief:s1' },
    ),
    event(
      'provider.tool',
      575,
      {
        type: 'tool',
        text: 'command_execution item_1 (completed)\ngit status --short\nexit_code: 0\n',
        provenance: 'live',
      },
      { session_id: 'chief:s1' },
    ),
  ];
  tasks.forEach((task, index) => {
    const session = `session:${index + 1}`;
    events.push(
      event(
        'task.created',
        560 - index,
        { request_key: 'k', subject_id: task.id },
        { task_id: task.id, actor_id: 'chief:s1' },
      ),
    );
    events.push(
      event(
        'task.delegated',
        550 - index,
        { request_key: 'k', subject_id: 'delegation:' + index },
        { task_id: task.id, actor_id: 'chief:s1' },
      ),
    );
    if (index % 2 === 0) {
      events.push(
        event(
          'provider.tool',
          400 - index,
          {
            type: 'tool',
            text: JSON.stringify({
              type: 'tool_use',
              id: `toolu_${index}`,
              name: 'Edit',
              input: {
                file_path: 'src/export.ts',
                old_string: 'const rate = 200;',
                new_string:
                  'const rate = 60;\nexport const header = "id,montant";',
              },
            }),
            provenance: 'live',
          },
          { session_id: session, task_id: task.id },
        ),
      );
      events.push(
        event(
          'provider.tool',
          390 - index,
          {
            type: 'tool',
            text: JSON.stringify({
              type: 'tool_use',
              id: `toolb_${index}`,
              name: 'Bash',
              input: { command: 'npm test -- export' },
            }),
            provenance: 'live',
          },
          { session_id: session, task_id: task.id },
        ),
      );
      events.push(
        event(
          'provider.tool',
          380 - index,
          {
            type: 'tool',
            text: JSON.stringify({
              type: 'tool_result',
              tool_use_id: `toolb_${index}`,
              content: '15 tests réussis\nfin',
              is_error: false,
            }),
            provenance: 'live',
          },
          { session_id: session, task_id: task.id },
        ),
      );
    } else {
      events.push(
        event(
          'provider.tool',
          400 - index,
          {
            type: 'tool',
            text: 'command_execution item_9 (in_progress)\nnpm run lint\nexit_code: unavailable\n',
            provenance: 'live',
          },
          { session_id: session, task_id: task.id },
        ),
      );
      events.push(
        event(
          'provider.tool',
          395 - index,
          {
            type: 'tool',
            text: 'command_execution item_9 (completed)\nnpm run lint\nexit_code: 1\nsrc/a.ts: 2 erreurs',
            provenance: 'live',
          },
          { session_id: session, task_id: task.id },
        ),
      );
      events.push(
        event(
          'provider.tool',
          390 - index,
          {
            type: 'tool',
            text: 'file_change item_10 (completed)\n[{"path":"src/review.md","kind":"add"}]',
            provenance: 'live',
          },
          { session_id: session, task_id: task.id },
        ),
      );
    }
    events.push(
      event(
        'provider.text',
        300 - index,
        {
          type: 'text',
          text: `Agent ${index + 1} : avancement transmis au chef \u001b]52;c;INJECTED\u0007.`,
          provenance: 'live',
        },
        { session_id: session, task_id: task.id },
      ),
    );
    if (index === 0 || index === 2)
      events.push(
        event(
          'handoff.submitted',
          200 - index,
          { request_key: 'k', subject_id: `handoff:${index}` },
          { task_id: task.id, actor_id: session },
        ),
      );
  });
  if (agents > 0)
    events.push(
      event(
        'provider.permission',
        20,
        {
          type: 'permission',
          text: JSON.stringify([
            { tool_name: 'Bash', tool_input: { command: 'npm publish' } },
          ]),
          provenance: 'live',
        },
        { session_id: 'session:1', task_id: 'task:t1' },
      ),
    );
  events.push(
    event(
      'question.requested',
      10,
      { request_key: 'k', subject_id: 'question:q1' },
      { actor_id: 'chief:s1' },
    ),
  );
  events.push(
    event(
      'provider.usage',
      5,
      {
        type: 'usage',
        usage: { input_tokens: 1200, output_tokens: 340 },
        provenance: 'live',
      },
      { session_id: 'chief:s1' },
    ),
  );
  const status = {
    project: {
      root: '/projets/factures',
      config: {
        permissions: {
          profile: 'workspace',
          allow_production: false,
          allow_external_publication: false,
        },
      },
    },
    run: {
      id: 'run:demo',
      objective: 'Ajouter un export CSV des factures',
      status: 'running',
      chief_provider: 'codex',
      chief_model: 'gpt-5.1',
      version: 42,
      max_active_agents: 4,
      acceptance_criteria: [
        { description: 'L’export contient une ligne par facture' },
      ],
    },
    tasks,
    sessions,
    events,
    questions: [
      {
        id: 'question:q1',
        question: 'Conserver le séparateur point-virgule pour Excel ?',
        options: [
          { label: 'Oui', consequence: 'Compatibilité Excel FR' },
          { label: 'Non', consequence: 'Virgule standard' },
        ],
        affects_task_ids: agents ? ['task:t1'] : [],
        blocking: true,
        status: 'open',
        requested_by: 'chief:s1',
        created_at: at(10),
      },
    ],
    decisions: [
      {
        id: 'decision:d1',
        question: 'Format de date ?',
        answer: 'ISO 8601',
        status: 'approved',
        created_at: at(500),
      },
    ],
    verifications: [],
    blockers: [],
    activity: {
      active: [
        { id: 'turn:1', run_id: 'run:demo', role: 'chief' },
        { id: 'turn:2', run_id: 'run:demo', role: 'worker' },
      ],
      queued: [],
    },
    contexts: [],
  };
  const team = {
    result: {
      messages: [
        {
          id: 'message:m1',
          sender_id: 'user:local',
          recipient_kind: 'chief',
          recipient_id: 'chief:current',
          kind: 'correction',
          content: 'Ajoute le cas d’accès refusé.',
          status: 'delivered',
          created_at: at(120),
        },
        ...(agents > 1
          ? [
              {
                id: 'message:m2',
                sender_id: 'chief:s1',
                recipient_kind: 'task',
                recipient_id: 'task:t2',
                kind: 'information',
                content: 'Le contrat de t1 est publié.',
                status: 'queued',
                created_at: at(4),
              },
            ]
          : []),
      ],
      delegations: tasks.map((task, index) => ({
        id: 'delegation:' + index,
        task_id: task.id,
        provider: index % 2 ? 'codex' : 'claude',
        model: null,
        status: 'claimed',
      })),
      user_responses: [],
    },
  };
  const report = {
    handoffs: [
      {
        id: 'handoff:0',
        task_id: 'task:t1',
        status: 'delivered',
        summary: 'Export CSV livré avec en-tête et tests.',
        verifications: [
          { result: 'passed', mode: 'live' },
          { result: 'passed', mode: 'live' },
        ],
        limitations: [],
        created_at: at(200),
      },
      {
        id: 'handoff:2',
        task_id: 'task:t3',
        status: 'partial',
        summary: 'Tests d’accès refusé partiels.',
        verifications: [{ result: 'failed', mode: 'live' }],
        limitations: ['Cas admin non couvert'],
        created_at: at(198),
      },
    ],
    reviews: [],
  };
  return { status, team, report, now };
}
