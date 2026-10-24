# Revue indépendante du runtime L07

What this change does: le runtime lance les tours du chef et des workers, assemble leur contexte, expose la coordination authentifiée et prépare l'acceptation des livraisons. Cette revue recherche des défauts de comportement dans cette combinaison, sans modifier le produit.

Révision relue : `947d9f724848e17f89f2b3025052ab54baa1fe8a`. Périmètre : `packages/supervisor/src/coordinator.ts`, `runtime.ts`, `main.ts`, `bridge.ts` ; lecture des frontières Store, capacités, scheduler, contexte, transport et workspaces lorsque nécessaire. Les lignes ci-dessous désignent **cette révision**, pas les fichiers en cours de correction.

Base Store demandée : `a7fd315ce4c4752a2a25595e584b5ea5d42c28b2`. Les probes ont utilisé le build local déjà présent ; sa source Store comporte en plus l'élargissement des namespaces d'observation de `77bbd9fc8f15b3920c0e2b76e705322a343934a2` (hunk autour de Store:2042). Les méthodes de questions, claim, contextes et lectures utilisées ici restent celles de la base a7fd315. Les sources du compilateur de contexte sont identiques à 947d9f7.

Pour les probes runtime, le fichier `runtime.ts` de **947d9f7** a été extrait par `git show`, transpilé avec le TypeScript installé (`target ES2023`, `module ESNext`) dans un répertoire temporaire, puis ses imports relatifs ont été dirigés vers le build local. Cela empêche les corrections concurrentes du runtime de modifier le comportement reproduit. SQLite et HTTP sont réels ; les frontières fournisseur sont absentes ou explicitement simulées. Node observé : `v26.12.0`. Tous les répertoires temporaires ont été nettoyés. Aucun CLI Claude/Codex ni modèle n'a été lancé.

## Must fix

### 1. [P1] Une pause ne clôt pas les tours encore en préparation

**Où :** runtime:375, 579–584, 975–988 et 1080–1108.

**Problème :** `adapter.probe()` et la compilation du contexte précèdent l'inscription dans `active`. `pause` n'interrompt que cette collection, puis rend `paused`. Une préparation déjà entrée continue et appelle ensuite `start` sans recontrôler le statut. La même fenêtre existe pour les autres actions qui interrompent un tour en préparation.

**Preuve exécutée :** run documentation, limite 1, adaptateur fake dont `probe` attend une promesse contrôlée. Attendre l'entrée dans `probe`, appeler `admin(pause)`, puis libérer la promesse. Le `start` fake enregistre le statut et lève immédiatement un marqueur de test ; aucun processus natif n'est créé.

```json
{"pause_returned_status":"paused","fake_start_calls_after_pause":1,"status_observed_at_fake_start":"paused","native_provider_started":false}
```

**Correction attendue :** enregistrer/fencer le tour dès sa préparation ; invalider sa génération de lancement lors de pause/stop/remplacement/fermeture ; revalider le statut et l'identité avant le lancement ; attendre ou annuler les préparations concernées dans `interrupt`. **Conséquence :** un utilisateur reçoit une confirmation de pause alors qu'un nouveau processus peut encore démarrer et agir.

**Régression demandée :** placer une barrière dans `probe`, puis dans une étape de préparation asynchrone, exercer pause/stop/replace-chief/close et vérifier qu'aucun ancien lancement n'est possible après retour de la commande.

### 2. [P1] Une question bloquante sur une tâche prête provoque une boucle de relance

**Où :** runtime:147–179 et 276–282 ; Store a7fd315:1148–1157, 1946–1950.

**Problème :** une question bloquante affectant une tâche `ready` conserve ce statut (Store ne déplace que les tâches `running`). Le pump l'enfile ; `claimTask` refuse correctement la question ouverte ; le `finally` du job rappelle immédiatement `wake` avec la même délégation encore `queued`. Avec une seule place, le chef reste également écarté par `hasWorkers`.

**Preuve exécutée :** SQLite temporaire, run démarré avec `max_active_agents=1`, tâche prête déléguée au fournisseur fake, question bloquante ouverte avant `wake`. La liste des adaptateurs du runtime est vide : la frontière fournisseur ne peut pas être atteinte. Arrêt du probe après 35 ms.

```json
{"elapsed_ms":35,"task_status":"ready","question_status":"open","attempts":0,"launch_failed_events":67,"queued_delegations":1,"providers_started":0}
```

**Correction attendue :** filtrer les questions bloquantes pertinentes avant l'enqueue et les recontrôler à l'entrée du worker ; traiter l'attente comme un état stable jusqu'à une réponse ou un changement utile. **Conséquence :** consommation CPU/écritures répétées et occupation logique de la place alors que le travail doit attendre l'utilisateur.

**Régression demandée :** garder une tâche prête déléguée derrière une question ouverte sans relance ni tentative ; répondre puis vérifier un seul claim/lancement autorisé. Une question visant une autre tâche ne doit pas bloquer celle-ci.

### 3. [P1] `status` finit par dépasser la borne HTTP malgré la pagination

**Où :** runtime:933–949, particulièrement `contexts` ligne 947 ; transport:231–237 ; protocole `MAX_JSON_BYTES=1_048_576`.

**Problème :** `limit` borne uniquement les événements. Chaque lecture renvoie tous les ContextBundle complets, jusqu'à la limite de 1000 records Store. Les prompts s'accumulent au fil des tours ; le transport refuse la réponse entière au-delà de 1 MiB. Réduire `limit` ou se reconnecter ne résout pas cette erreur.

**Preuve exécutée :** vingt contextes valides issus du compilateur réel, contenant des données de travail ordinaires non sensibles, persistés dans SQLite ; `admin(status, {limit:1})`, puis le même appel via transport et client authentifiés réels.

```json
{"contexts":20,"one_context_bytes":67268,"status_bytes":1347431,"event_limit":1,"http_error":"BODY_TOO_LARGE","providers_started":0}
```

**Correction attendue :** servir des résumés bornés de contexte dans `status`, garder le détail exact dans `inspect_context`, et borner/paginer les autres collections de statut. **Conséquence :** les commandes de statut et les vues attachées deviennent durablement indisponibles pendant un chantier normal.

**Régression demandée :** accumuler suffisamment de contextes pour dépasser 1 MiB en forme complète ; vérifier que HTTP status reste lisible et que le contexte ciblé reste inspectable sans perte silencieuse.

### 4. [P1] Les références de source transmises au worker ne sont pas résolues

**Où :** runtime:396–399 ; `selectTaskSources` accepte explicitement un troisième argument `previousSources`.

**Problème :** le runtime appelle `selectTaskSources(project, task)` sans les SourceRef déjà persistés. `inspectProject(...).sources` décrit les métadonnées racine, pas tous les fichiers précédemment sélectionnés par le chef. Une tâche dont `context_source_ids` référence un fichier `src/*` échoue donc avant son lancement. Le changement de racine physique du worktree renouvelle aussi l'identité du snapshot.

**Preuve exécutée :** créer `src/billing.ts`, le sélectionner dans une première racine, copier le projet dans une seconde racine et transmettre l'ancien SourceRef dans le TaskSpec. Appeler la sélection comme 947d9f7, puis avec le troisième argument historique.

```json
{"baseline":"CONTEXT_SOURCE_MISSING","with_previous_sources":true,"replacement_recorded":true}
```

**Correction attendue :** transmettre les SourceRef du run au sélecteur, conserver la revalidation des fichiers et les remplacements d'identité. **Conséquence :** une délégation correctement sourcée par le chef ne peut pas démarrer.

**Régression demandée :** chef sélectionnant une source, tâche avec cet ID, worker dans une autre racine/worktree ; compiler le prompt et vérifier le contenu actuel et la provenance remplacée. Le coordinateur a annoncé le troisième argument ajouté ; contre-vérification de son candidat à réaliser.

## Should fix

### 5. [P2] Le chemin du pont MCP reste encodé dans les installations avec espaces

**Où :** runtime:560.

**Problème :** `new URL('./bridge.js', import.meta.url).pathname` conserve `%20` et les séquences UTF-8 encodées. Node reçoit alors un chemin différent du fichier réel quand le paquet est installé dans un répertoire avec espace ou caractère non ASCII.

**Preuve exécutée :** construire une URL de fichier sous un chemin `install é/bridge.js`, comparer `.pathname` au chemin natif et vérifier `fileURLToPath`.

```json
{"bridge_pathname_encoded":true,"bridge_fileURLToPath_correct":true}
```

**Correction attendue :** utiliser `fileURLToPath`. **Conséquence :** le processus du pont ne trouve pas son module et le fournisseur perd les outils de coordination. Correction déjà annoncée et visible dans `77bbd9fc8f15b3920c0e2b76e705322a343934a2` ; le probe ci-dessus valide la primitive, pas encore un lancement du pont depuis ce paquet corrigé.

**Régression demandée :** lancer le pont du paquet copié sous un chemin contenant espace et Unicode, puis exercer initialize/tools/list avec un transport de test authentifié.

## Contrôles de lecture et limites de preuve

- Identité/ACL : les ToolCall sont validés ; l'acteur provient du principal authentifié ; les outils sont filtrés par rôle et run ; les mutations Store contrôlent génération/tentative. Le cap est revalidé à l'authentification. Aucun contournement supplémentaire confirmé dans les chemins lus.
- Reprises/idempotence : le coordinateur conserve une intention d'opération et le Store ses reçus ; les mêmes clés et contenus peuvent être rejoués. Cette lecture n'est pas une recette exhaustive des crashes entre chaque effet externe et chaque enregistrement.
- Promotion : `accept_delivery` appelle `validateDelivery` avant `promoteIntegration`, puis `acceptDelivery` ; le Store vérifie la livraison et la revue courantes. Aucun cas de promotion avant revue confirmé dans cette source. Les scénarios E2E d'intégration restent la preuve d'exécution attendue.
- Chef/DAG et places : le chef possède une session de contrôle, pas une fausse tâche ; le scheduler compte ses tours dans la limite. Le cas de question ci-dessus casse la progression à une place. Les sept places avec fournisseurs natifs n'ont pas été exercées ici.
- Durée de vie de la vue : le service possède ses tours indépendamment de la connexion HTTP ; aucun arrêt de fournisseur n'est associé à la déconnexion d'une lecture. La régression CLI PTY est dans la livraison CLI, pas rejouée dans cette revue.
- Erreurs/backpressure : lecture du chemin d'observation et du `Promise.all` événements/résultat ; les recettes natives et les tests du runner existants n'ont pas été rejoués. Le défaut de préparation/pause est prouvé à la frontière fake contrôlée.

**Verdict : Request changes sur 947d9f7.** Cinq constats transmis au coordinateur, corrections produit sous sa responsabilité. Ce rapport ne prononce pas l'acceptation d'un candidat corrigé. Aucun fichier produit, contrat, manifeste, test existant ni état de coordination n'a été modifié par cette revue ; seul ce rapport est ajouté.
