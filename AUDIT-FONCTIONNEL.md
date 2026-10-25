# Audit fonctionnel — Avity Crew

Date : 25 octobre 2026 (Europe/Paris).

Revue du produit (CLI, superviseur, stockage, adaptateurs Claude et Codex) confrontée à la documentation utilisateur. Les constats viennent de la lecture du code actuel. La suite de tests n'a pas été relancée pour cet audit. Un contrôle de résolution de `PATH` a été exécuté.

## Synthèse

Le moteur de livraison tient : une sortie native ou un texte « terminé » ne clôt pas un run, les preuves passent par des contrôles de révision, et le mode documentation n'initialise pas Git. Plusieurs parcours cassent dès qu'il y a plus d'un objectif, ou dès qu'une pause tombe pendant la vérification documentaire. Le stockage des tâches n'est pas isolé par run.

| Gravité | Nombre | Thème |
| --- | --- | --- |
| Majeur | 5 | Runs multiples, pause, identifiants de tâches, plafond de statut, fichier objectif |
| Mineur | 7 | Raccourcis, libellés, codes de sortie, journal d'opérations, doc interne |

## Majeurs

### 1. Sans `--run`, ce n'est pas le run en cours

`avity-crew` sans argument ne rejoint un run que s'il n'est pas terminal (`completed`, `failed`, `cancelled`).

```122:127:apps/cli/src/main.ts
  const active =
    current.run &&
    !['completed', 'failed', 'cancelled'].includes(current.run.status ?? '')
      ? (current.run.id ?? null)
      : null;
  return runTui(client, { project: project.root, run: active, home: !active });
```

`status`, `watch` et `attach` sans `--run` prennent le dernier run créé, terminal ou non. Le tri est `rowid DESC`.

```1381:1384:packages/supervisor/src/runtime.ts
    const runId =
      typeof args['run_id'] === 'string'
        ? args['run_id']
        : this.store.listRuns(1)[0]?.id;
```

`attach` sans `--run` ouvre aussi ce dernier run : le drapeau d'accueil n'est posé que pour l'entrée interactive.

Scénario : un objectif terminé vient d'être créé, un plus ancien tourne encore. `avity-crew` affiche l'accueil. `avity-crew status`, `watch --once` et `attach` observent l'objectif terminé. `watch --once` peut sortir 0 tout de suite, alors qu'un autre run travaille.

### 2. `pause` et `stop` peuvent échouer après la mort du processus

`interrupt` tue le processus, attend sa fin, puis laisse 2 secondes au tour pour quitter `active`. Passé ce délai, l'admin lève `RECONCILIATION_REQUIRED` et ne passe pas le run à `paused` ou `cancelled`.

```1673:1684:packages/supervisor/src/runtime.ts
    for (
      let index = 0;
      index < 100 &&
      [...this.active.values()].some((turn) => turns.includes(turn));
      index++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    if ([...this.active.values()].some((turn) => turns.includes(turn)))
      throw new CrewError(
        'RECONCILIATION_REQUIRED',
        'Turn exit is not yet observed',
      );
```

Le tour fait encore la vérification documentaire après la sortie du processus, avec un budget de 10 secondes (`verifyDocuments`, `runCommand(..., 10000)`). Il ne se retire de `active` qu'ensuite. Le drapeau `suspending` est retiré dans le `finally` de la pause, même si la pause a échoué.

Scénario : mode documentation, worker déjà sorti, empreintes en cours de contrôle. L'utilisateur lance `pause`. Au bout de 2 secondes la commande échoue, le run reste `running`, puis le scheduler peut enchaîner un autre tour.

### 3. Les identifiants de tâche sont globaux au projet

`tasks.id` est une clé primaire seule. Les autres enregistrements sont scopés par `(run_id, kind, id)`.

```68:70:packages/storage/src/index.ts
   CREATE TABLE tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), status TEXT NOT NULL, generation INTEGER NOT NULL, active_attempt_id TEXT REFERENCES attempts(id) DEFERRABLE INITIALLY DEFERRED, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
   CREATE TABLE attempts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), task_id TEXT NOT NULL REFERENCES tasks(id), status TEXT NOT NULL, generation INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
   CREATE TABLE records (run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL, id TEXT NOT NULL, task_id TEXT REFERENCES tasks(id), actor_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(run_id, kind, id)) STRICT;
```

L'identifiant vient de la `TaskSpec` choisie par le chef (`create_task`). Une collision remonte en erreur SQLite brute : `transaction()` relance l'exception telle quelle, sans `CrewError`. `getTask` lit aussi par `id` seul.

Scénario : un run documentaire a déjà `task:guide`. Un second run sur le même dépôt recrée `task:guide`. La création échoue avec `UNIQUE constraint failed: tasks.id`. Le chef voit une erreur interne, pas un conflit de mission.

### 4. Le plafond de `get_status` ne borne pas la première page

Le contrat vise environ 40 000 caractères. La place restante est `40_000` moins le JSON déjà assemblé (run, tâches, messages). Si ce reste est négatif, ou si le premier événement est plus gros que la place, il est ajouté quand même : le test `size > room` ne s'applique qu'à partir du deuxième événement.

```77:84:packages/supervisor/src/coordinator.ts
  for (const event of page) {
    const item = select(event);
    if (item !== null) {
      const size = JSON.stringify(item).length + 1;
      if (size > room && events.length)
        return { events, next_seq, has_more: true };
```

La TUI demande `get_status` avec `limit: 200`. Un historique chargé peut dépasser ce que le client MCP accepte. Le chef perd alors sa page d'état au lieu de recevoir une page courte avec `has_more`.

### 5. Un fichier objectif absent est masqué

`run --prompt-file absent.md` fait un `stat` sans traduire `ENOENT`. Toute erreur qui n'est pas un `CrewError` devient le message générique « Commande non exécutée ; vérifier le projet et les prérequis avec doctor. », code de sortie 1. La documentation réserve le code 2 aux erreurs d'usage. L'utilisateur ne voit pas que le fichier manque.

## Mineurs

1. **Ctrl+J ne fait rien.** `docs/USAGE.md`, `docs/CLI.md` et le message de `/compose` disent qu'Alt+Entrée ou Ctrl+J insère une ligne. Le clavier gère Alt+Entrée (`return` + `meta`) et la touche `enter`. Aucun `ctrl` + `j`. Sur un terminal où Alt+Entrée n'envoie pas `meta`, Entrée envoie le message.

2. **`status` humain étiquette l'identifiant comme objectif.** Dans `apps/cli/src/view.ts`, la ligne `Objectif :` affiche `run.id`. Le vrai objectif est la ligne suivante, sans libellé.

3. **`/answer` dans `docs/CLI.md` ne correspond pas à la TUI.** La doc dit `/answer ID texte`. La palette et le parseur attendent `/answer question:ID réponse`. La commande non interactive exige `--question`.

4. **`export --json` sans `--format json` reste du Markdown.** `--json` n'enveloppe que la sortie. Le format par défaut est `markdown`, donc `data` est une chaîne. La boucle qui concatène les pages ne tourne que si `format === 'json'`.

5. **Le refus Git n'est expliqué que dans le formulaire TUI.** `GIT_INITIALIZATION_REQUIRED` y devient « mode documentation ou `--init-git` ». `avity-crew run --mode code` dans un dossier sans Git renvoie le message du superviseur et le code 1.

6. **Une opération `tool.*` en échec reste ouverte.** Dans `Coordinator.execute`, le `catch` journalise `tool.failed` et relance l'erreur. Il n'appelle pas `observeOperation(..., 'failed')`. L'opération reste hors `completed` / `failed`. La reprise ne réconcilie que les `provider.turn`, donc le run n'est pas bloqué, mais le journal d'opérations reste ouvert.

7. **Sonde Codex et lancement ne parcourent pas `PATH` de la même façon.** `CodexProvider.probe` ignore les segments vides (`filter(Boolean)`). `spawn('codex')` suit le `PATH` POSIX, où un segment vide signifie le répertoire courant. Un `PATH` qui commence ou finit par `:` peut faire sonder `/usr/bin/codex` et exécuter `./codex`. Claude garde les segments vides des deux côtés : sonde et lancement restent alignés, y compris sur un binaire du répertoire courant. Contrôle exécuté : `resolve('', 'claude')` vaut le `claude` du répertoire courant.

## Incohérences de contrat

Le code produit est cohérent avec lui-même sur ces points. Le cahier `avity-crew-workpack/docs/DATA_MODEL.md` ne l'est pas.

- Le cahier dit que la délégation crée une tentative et passe la tâche de prête à en cours. `delegateTask` n'écrit qu'une délégation `queued` avec `attempt_id: null`. La tentative naît dans `claimTask`.
- Le statut `planned` est dans le schéma et la table de transitions. `createTask` pose directement `ready` ou `waiting_dependency`.
- `recordDecision` persiste `{ ...decision, provenance }` et retourne l'objet d'entrée, sans provenance. Une relecture en base la contient.
- `assertLiveVerification` n'est appelé que par les tests. Les preuves du produit sont écrites en `mode: 'static'` après une commande réelle (`verifyDocuments`, `propose_integration`). Ce n'est pas une porte pour faire accepter une simulation : `saveVerification` n'est pas un outil d'agent. La garde « live » existe et n'est branchée nulle part.

Le statut Git complet (`git status --short`, jusqu'à 1 Mio) est injecté dans le brief (`project.git`), après `redactContext`. Cette fonction masque des secrets dans le texte, pas les noms de fichiers. Un `.env` ou une clé non ignorée apparaît donc dans le prompt, alors que la lecture du fichier lui-même est exclue.

## Ce qui tient

- `/cancel` efface le brouillon : `submit` et la palette vident la saisie avant d'exécuter la commande. Le `case 'cancel'` ne fait qu'afficher le message.
- Le mode documentation n'appelle `initializeRepository` qu'en mode `code`.
- `finishRun` recalcule les acceptations, exige des artefacts et refuse une complétion sans preuves.
- La file du coordinateur sérialise les mutations. Un outil lent sur un run retarde les autres. C'est une limite de réactivité, pas une perte d'autorité.

## Limite de cette revue

Lecture statique du dépôt, plus un contrôle de résolution de `PATH`. Pas de recette Claude ou Codex réelle, pas de `npm test` relancé pour cet audit. Le verrou d'intégration qui considère un PID mort comme libérable est déjà marqué comme raccourci dans `recoverIntegrationLock` : un PID recyclé peut reprendre un lock qui n'est plus le sien.
