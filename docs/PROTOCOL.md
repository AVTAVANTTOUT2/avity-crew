# Transport local du superviseur

Le module `packages/supervisor/src/protocol.ts` définit le protocole local v1 et les types partagés. Le transport injecte `SupervisorApi`, sans implémenter le moteur métier :

```ts
interface SupervisorApi {
  tools(principal: Principal, runId: string): ToolDescriptor[];
  execute(principal: Principal, call: ToolCall): Promise<unknown>;
  admin(principal: Principal, request: AdminRequest): Promise<unknown>;
}
interface AdminRequest {
  method: string;
  arguments: Record<string, unknown>;
}
```

`ToolDescriptor` contient `name: ToolCall['method']`, `description`, `inputSchema` et éventuellement les hints MCP `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. L'API métier fournit les outils effectivement permis et leurs schémas développés, sans référence locale non résolue. Le transport ne choisit pas les rôles métier ni les règles de livraison.

## Service HTTP et propriété locale

`startTransport({directory, project_id, registry, api})` retourne `{endpointFile, endpoint, close()}`. Le serveur écoute uniquement `127.0.0.1`, sur un port alloué par le système. La racine du service est `http://127.0.0.1:<port>/v1/<nonce>/`. L'Origin navigateur est refusé et le Host doit correspondre au service.

Le répertoire doit être privé (0700), non symbolique. Les fichiers de service sont 0600 :

- `supervisor.lock` contient `protocol`, `project_id`, `pid`, `nonce`, acquis par création exclusive.
- `endpoint.json` ajoute `url`, publié par renommage. Il ne contient aucune capability ni clé.
- `owner.key` est créé séparément par `CapabilityRegistry` et ne figure jamais dans les métadonnées d'endpoint.
- `supervisor.starting`, également exclusif, sérialise les démarrages et récupérations d'un ancien lock. Il est libéré après publication ou échec propre, uniquement avec le nonce du démarrage.

Un lock principal/endpoint ancien n'est récupéré que si son projet/protocole/PID/nonce sont valides et si `kill(pid, 0)` confirme `ESRCH`. PID vivant, `EPERM`, autre erreur ou métadonnée ambiguë provoquent un refus ; aucun fichier n'est effacé par déduction d'un simple délai. Le garde de démarrage ambigu ou interrompu est conservé pour inspection explicite, même si le PID semble ancien : aucun retrait concurrent spéculatif. Après une interruption pendant ce très court passage, une intervention de réconciliation de propriété peut donc être nécessaire.

`close()` est idempotent et supprime seulement les fichiers portant encore son propre nonce. Il ferme les connexions HTTP ; le cycle de vie des tâches métier reste au superviseur. La CLI lance le service détaché, dont le point d'entrée raccorde ce transport au runtime. Cette API de transport ne daemonise pas elle-même le service.

## Authentification et routes

Chaque requête porte `Authorization: Bearer <capability>`. `CapabilityRegistry.authenticate` fournit exclusivement le `Principal`, vérifié contre le projet de l'endpoint. Les requêtes avec body sont réauthentifiées après réception pour observer une révocation pendant la lecture.

Un principal agent ne peut lire/exécuter que son `run_id`. Avant `execute`, la méthode doit apparaître dans `api.tools(principal, runId)`. Le `ToolCall` complet passe la validation contractuelle existante ; un champ `actor` ajouté au body est refusé. L'identité du body n'est jamais utilisée comme autorité. Les mutations métier vérifient aussi transactionnellement les générations, l'autorité du chef et la tentative active au moment de l'effet : une entrée en file ne conserve pas un droit révoqué.

| Route relative         | Entrée                | Résultat                                      |
| ---------------------- | --------------------- | --------------------------------------------- |
| `GET health`           | capability valide     | Métadonnées de propriété sans secret          |
| `GET tools?run_id=...` | run autorisé          | Descripteurs injectés par l'API métier        |
| `POST call`            | `ToolCall` v1         | `api.execute(principal, call)`                |
| `POST admin`           | `{method, arguments}` | `api.admin` uniquement pour le principal user |

Réponse : `{ok:true,result:...}` ou `{ok:false,error:{code,message}}`. Les détails et messages bruts d'exceptions ne traversent pas le transport ; seul un code borné et un message générique sont exposés, afin de ne pas renvoyer une capability contenue dans une erreur métier. Les données de résultat autorisées restent de la responsabilité de l'API.

Requêtes/réponses JSON et lignes MCP sont limitées à 1 MiB. Métadonnées privées : 8 KiB. Réception HTTP et client ont un délai de 10 secondes par défaut ; le client peut choisir de 1 ms à 60 secondes. La limite client est une échéance totale, indépendante du débit de données. Le statut d'une mutation après déconnexion/délai peut être **inconnu** : le client ne la relance pas automatiquement et ne transforme pas l'absence de réponse en échec métier certain.

## Client et fallback CLI

`new SupervisorClient({endpointFile, capability, timeout_ms?})` fournit `tools(runId)`, `execute(call)` et `admin(request)`. Le fichier d'endpoint est relu à chaque appel, ce qui permet de joindre une nouvelle instance après fermeture/redémarrage sans créer un autre client. Seul HTTP sur l'adresse littérale `127.0.0.1`, avec le chemin/protocole/nonce attendus et sans userinfo/query/fragment, est accepté. Aucun redirect HTTP n'est suivi.

Le fallback CLI interne doit construire le même `ToolCall` et appeler `execute`. La capability arrive par environnement ou canal privé, jamais par argument de processus ou prompt. Conserver `request_id`, `idempotency_key`, `run_id`, `expected_version` et `arguments` lors d'une reprise. L'idempotence et les effets sont traités par le métier/Store, pas par un compteur HTTP ou un identifiant JSON-RPC.

`expected_version` ordonne les décisions de l'utilisateur et du chef : une valeur périmée y produit `VERSION_CONFLICT`. Pour un agent de tâche (worker, reviewer…), le Store vérifie déjà tentative active, génération et état de la tâche ; la version du run y est indicative, afin qu'une mutation du chef ne rejette pas une passation ou une revue préparée entre-temps.

`get_status` reste lisible par un client MCP natif : textes d'événements abrégés, réponse bornée (environ 40 000 caractères) et pagination par `next_seq`/`has_more`. Le statut et l'export administratifs gardent les événements complets, par pages bornées sous la limite de 1 MiB. Comme seuls les codes traversent le transport, un défaut précis reçoit un code distinct : `REVIEW_SOURCE_MISMATCH` signale une revue dont `source_revision` n'est pas celle de la passation (le SHA du candidat combiné va dans `tested_revision`).

## Pont MCP stdio

`runMcpBridge({client, runId, input?, output?})` utilise le même client. `runMcpFromEnv()` lit exclusivement les variables `AVITY_CREW_ENDPOINT_FILE`, `AVITY_CREW_CAPABILITY`, `AVITY_CREW_RUN_ID`. Le service prépare cet environnement pour le pont natif ; `avity-crew internal mcp` expose la même entrée. stdout contient uniquement JSON-RPC MCP, une ligne UTF-8 par message, avec backpressure.

La version prise en charge est explicitement **2025-11-25**, avec `initialize`, notification `notifications/initialized`, puis `tools/list`, `tools/call` et `ping`. Une version inconnue demandée dans initialize reçoit la version connue du serveur, jamais une valeur arbitraire reflétée. Le client décide s'il la prend en charge. La nouvelle révision 2026-07-28 utilise un autre lifecycle : elle n'est pas revendiquée ici. Les interfaces des CLI ciblées par le chantier utilisent le lifecycle initialize ; leur recette réelle sur le pont complet appartient à l'intégration.

Chaque outil expose dans `inputSchema` l'enveloppe complète **sans `method`**, fixé par son nom : `schema_version`, `request_id`, `idempotency_key`, `run_id`, `expected_version`, `arguments`. Ces valeurs sont fournies explicitement par l'appelant. Le pont ne fabrique jamais une clé d'idempotence à partir du seul `id` JSON-RPC, réutilisable. Un `method` supplémentaire dans cette enveloppe est refusé. Les erreurs d'exécution deviennent des résultats d'outil `isError`, les erreurs de protocole des erreurs JSON-RPC bornées.

Sources officielles effectivement consultées : [lifecycle 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [stdio 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [lifecycle courant](https://modelcontextprotocol.io/specification/latest/basic/lifecycle). La compatibilité optionnelle avec d'autres révisions doit être vérifiée avant d'être annoncée.

## Vérification

Après build : `node --test dist/tests/supervisor-transport.test.js`. Les tests ouvrent de vrais sockets HTTP et bases SQLite temporaires, et lancent un vrai processus Node pour le pont MCP. Les callbacks métier sont explicitement des callbacks de test, avec leur propre table SQLite d'observation/déduplication ; ils ne remplacent pas le moteur du produit. Le même appel MCP puis fallback conserve son enveloppe et son identité authentifiée ; deux appels réutilisant le même id JSON-RPC mais des clés distinctes restent distincts.

La recette provider réelle, le service détaché et les règles métier du superviseur sont hors de ce module de transport. Aucun modèle LLM n'est invoqué par ses tests.
