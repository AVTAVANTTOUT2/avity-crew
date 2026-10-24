# Revue indépendante — capture et durée de vie des capacités

What this change does: le diff ajoute l'entrée `document_paths` pour une capture de document sans empreinte inventée par le modèle, révoque les capacités d'agent à la fin des tours et au démarrage du service, et nettoie les lancements qui échouent avant l'observation du processus.

**Révision relue :** `76fe256af8b9c7b58d705acf46f1c18f7df52b9c`.
**Diff :** `8443136..76fe256`, limité à `packages/supervisor/src/{capabilities,coordinator,runtime}.ts`. Lecture des contrats, du captureur Workspace et du démarrage du service uniquement pour vérifier leurs raccordements.

**Verdict : aucun nouveau défaut actionnable confirmé dans cette frontière.** Aucun constat bloquant ni correction produit demandée par cette revue. Ce verdict reste limité au diff et aux chemins exécutés ci-dessous ; il ne vaut pas acceptation d'une recette native complète. Les cinq constats précédemment clos n'ont pas été rouverts.

## Vérifications exécutées

Le JavaScript local de chacun des trois modules relus a été comparé à l'émission ESM du TypeScript extrait du candidat, avec les options du dépôt : identité octet pour octet pour `capabilities`, `coordinator` et `runtime`.

Commande exécutée indépendamment sous **Node 26.12.0**, sur macOS :

```text
node --test dist/tests/capabilities.test.js dist/tests/reconciliation.test.js dist/tests/runtime.test.js
exit 0 — 23 tests, 23 réussis, 0 échec, 0 ignoré
```

Ces tests comprennent les capacités privées et révoquées, la conservation de l'accès propriétaire, la pause/reprise/remplacement du chef avec ancien accès refusé, la reprise ciblée d'une conversation simulée après réconciliation explicite, les refus d'identité non vérifiable, la capture documentaire HTTP/SQLite sans hash déclaré et les parcours de revue/intégration simulés. Les tests de réconciliation emploient de vrais processus POSIX de laboratoire ; aucun modèle n'est lancé.

## Capture, scopes et rejeu

Lecture : `coordinator.ts:492–501`, `558–670` et raccordement `WorkspaceManager.collectDelivery`.

- `document_paths` est transmis au captureur ; en son absence, les anciens `artifacts` de type `file` fournissent encore les chemins. Le nouveau champ n'élargit pas le scope attribué : le captureur vérifie le scope passé et celui de la tâche, les exclusions, les chemins relatifs et les liens symboliques.
- Les artefacts, leurs IDs et leurs révisions persistés proviennent du résultat de capture ; `generation` est celle de l'acteur authentifié, `source_revision` est le snapshot calculé, et les vérifications déclarées par l'appelant ne deviennent pas des preuves observées.
- Le reçu du ToolCall couvre également `document_paths`. Une même clé avec des chemins différents reste un conflit d'idempotence ; le rejeu exact conserve le snapshot initial.

Probe indépendant exécuté avec **transport HTTP authentifié, Store SQLite sur disque et WorkspaceManager réels**, sans fournisseur : une tâche documentaire possède `docs/**`, avec exclusion de `docs/private/**`. Le Handoff d'entrée contient `source_revision:null`, `artifacts:[]`, `verifications:[]` et aucun hash. Le fichier est modifié après capture pour vérifier l'immuabilité du rejeu.

```json
{
  "outside_path": "OUTSIDE_SCOPE",
  "excluded_path": "OUTSIDE_SCOPE",
  "symlink": "INVALID_DOCUMENT",
  "server_hash_correct": true,
  "immutable_bytes": true,
  "replay_exact_after_source_change": true,
  "changed_paths_same_key": "IDEMPOTENCY_CONFLICT",
  "model_supplied_no_hash": true,
  "legacy_ArtifactRef_input_captured": true,
  "providers_started": 0
}
```

Le cas historique est exercé sur une seconde tâche : un `ArtifactRef.file` désigne le chemin relatif et l'appel omet `document_paths`. Le résultat est bien un nouvel artefact privé capturé avec l'empreinte des bytes observés. Les états de tâche et d'attempt du probe sont une préparation de test explicite ; aucune exécution LLM n'est revendiquée.

## Révocation et erreurs de lancement

Lecture : `capabilities.ts:142–160`, enveloppe `try/catch/finally` de `runtime.turn`, et `main.ts:34–40`.

- La révocation unitaire ne supprime pas la clé propriétaire et tolère un fichier de capacité déjà absent. L'invalidation globale cible les fichiers d'agents identifiés par leur digest.
- Le point de démarrage réel appelle `initialize()` après la réussite de `startTransport`, donc après l'acquisition du verrou singleton. Un second service qui échoue à acquérir le verrou n'atteint pas cette invalidation.
- La capacité est révoquée dans le `finally` du tour, ainsi qu'avant l'arrêt de nettoyage sur le chemin d'erreur. L'inscription dans `active` précède l'observation asynchrone du PID. Si cette observation ou l'enregistrement de lancement échoue, le processus est arrêté et ses événements sont drainés avant retrait de l'entrée active.

Probes supplémentaires exécutés sur une fixture privée après acquisition de son transport :

| Chemin contrôlé | Résultat observé |
| --- | --- |
| Ancienne capacité présente avant `initialize` | Ancien accès refusé avec `FORBIDDEN`, accès propriétaire toujours valide |
| `start` fake lève après réception de la demande, avant création d'un processus | Capacité refusée ensuite ; opération `failed`, `business_success:false`, run `waiting_provider`, zéro entrée active |
| Un vrai enfant Node de laboratoire est créé, puis `observeOperation(..., running)` lève une erreur contrôlée | Un appel de `stop`, sortie du processus observée, **200 événements drainés**, capacité refusée, opération `failed`, `business_success:false`, run `waiting_provider`, zéro entrée active |

Le dernier cas teste le nettoyage après obtention d'un handle de processus et avant le démarrage du lecteur normal. Le processus est un simple enfant Node contrôlé ; le protocole fournisseur et son résultat sont simulés. La clé propriétaire reste utilisable dans les deux cas d'erreur. Aucun PID extérieur à la fixture n'est signalé et tous les processus/répertoires temporaires ont été nettoyés.

## Limites

- Aucun CLI Claude/Codex ni fournisseur réel n'a été appelé. Les preuves natives d'acceptation restent celles de la recette coordonnée, distinctes de cette revue.
- Node 24, suite globale, CI distante et autres plateformes n'ont pas été rejoués ici. Les résultats Node 24/26 annoncés par le coordinateur ne sont pas présentés comme des exécutions de ce relecteur.
- Les probes couvrent les refus de scope/exclusion/symlink, le rejeu après modification du fichier et deux chemins d'erreur de lancement. Ils ne constituent pas une exploration exhaustive de tous les crashes possibles entre effets externes et écritures SQLite.
- Aucun code, contrat, manifeste, test persistant ni état du registre n'a été modifié. Seul ce rapport est ajouté ; la responsabilité de la passation L07 reste au coordinateur.
