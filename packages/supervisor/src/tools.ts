import { CrewError, runtimeSchema } from '../../contracts/src/index.ts';
import type { ToolCall } from '../../contracts/src/index.ts';
import type { Principal } from './capabilities.ts';

type Schema = Record<string, unknown>;
export interface CrewTool {
  name: ToolCall['method'];
  description: string;
  inputSchema: Schema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: false;
  };
}

const descriptions: Record<ToolCall['method'], string> = {
  inspect_project:
    'Inspecter les sources accessibles et leurs références vérifiées.',
  create_task:
    'Créer une mission précise, ses critères, son périmètre et ses dépendances.',
  amend_task:
    'Corriger une TaskSpec arrêtée après une décision approuvée, avec une raison conservée. Les critères et contraintes du run restent inchangés. Une livraison antérieure doit être resoumise et relue.',
  delegate_task:
    'Enregistrer une délégation et retourner immédiatement ; le superviseur lance les tours prêts.',
  get_status:
    'Lire le run, les tâches accessibles, la version courante et une page d’événements.',
  send_message:
    'Envoyer une information ciblée ; queued ne signifie pas que son destinataire l’a lue.',
  collect_delivery: 'Lire une passation et ses preuves conservées.',
  request_user_input:
    'Enregistrer une question et les seules tâches bloquées par sa réponse.',
  propose_integration:
    'Construire un candidat Git réunissant les snapshots et exécuter les contrôles configurés.',
  finish_run:
    'Demander la clôture avec preuves ; le moteur refuse les critères ou livraisons manquants.',
  read_context: 'Lire le contexte exact envoyé et ses sources autorisées.',
  publish_note:
    'Conserver une observation de sa mission sans la transformer en décision approuvée.',
  report_blocker: 'Signaler un blocage de sa mission et l’action nécessaire.',
  submit_handoff:
    'Capturer ses fichiers puis soumettre une livraison, sans l’accepter. Pour un document neuf : document_paths contient les chemins relatifs, handoff.artifacts et verifications restent vides, source_revision vaut null ; le serveur calcule les empreintes et les preuves observées.',
  record_decision:
    'Enregistrer un choix technique ou adopter une réponse utilisateur réellement référencée.',
  submit_review:
    'Relire une livraison indépendante ; une demande de correction peut précéder le candidat.',
  accept_delivery:
    'Demander l’acceptation après revue indépendante et vérifications de la révision exacte.',
};
const readOnly = new Set<ToolCall['method']>([
  'inspect_project',
  'get_status',
  'collect_delivery',
  'read_context',
]);
const worker = new Set<ToolCall['method']>([
  ...readOnly,
  'send_message',
  'publish_note',
  'report_blocker',
  'submit_handoff',
]);

// Expand only local references so each MCP tool is independently valid JSON Schema.
function expand(value: unknown, depth = 0): unknown {
  if (depth > 32)
    throw new CrewError('INVALID_SCHEMA', 'Recursive tool schema');
  if (Array.isArray(value))
    return value.map((entry) => expand(entry, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const node = value as Schema;
  if (typeof node['$ref'] === 'string') {
    const name = node['$ref'].replace(/^#\/\$defs\//, '');
    const definition = (runtimeSchema.$defs as Schema)[name];
    if (!definition)
      throw new CrewError('INVALID_SCHEMA', 'Unknown tool schema reference');
    return expand(definition, depth + 1);
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, entry]) => [key, expand(entry, depth + 1)]),
  );
}

const toolSchemas = (
  runtimeSchema.$defs.ToolCall.oneOf as unknown as Schema[]
).map((branch) => {
  const schema = expand(branch) as Schema;
  const properties = schema['properties'] as Schema;
  const name = (properties['method'] as { const: ToolCall['method'] }).const;
  delete properties['method'];
  schema['required'] = (schema['required'] as string[]).filter(
    (key) => key !== 'method',
  );
  return { name, schema };
});

export function toolsFor(principal: Principal): CrewTool[] {
  return toolSchemas
    .filter(({ name }) => {
      if (principal.kind === 'user' || principal.actor.role === 'chief')
        return ![
          'submit_review',
          'submit_handoff',
          'publish_note',
          'report_blocker',
        ].includes(name);
      return (
        worker.has(name) ||
        (name === 'submit_review' && principal.actor.role === 'reviewer')
      );
    })
    .map(({ name, schema }) => ({
      name,
      description: descriptions[name],
      inputSchema: schema,
      annotations: {
        readOnlyHint: readOnly.has(name),
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }));
}

export function assertToolAuthority(
  principal: Principal,
  call: ToolCall,
): void {
  if (principal.kind === 'agent' && principal.actor.run_id !== call.run_id)
    throw new CrewError('FORBIDDEN', 'Capability cannot access another run');
  if (!toolsFor(principal).some((tool) => tool.name === call.method))
    throw new CrewError('FORBIDDEN', 'Tool is unavailable for this role');
}
