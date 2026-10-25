# Espaces de travail et intégration

Le module `packages/workspace/src/index.ts` est le port Git du superviseur. Il
utilise les arguments structurés de Git, les API Node et le Store public. Il
n'accède pas directement aux tables SQLite. Les opérations administratives
reçoivent l'Actor `user` construit par le service authentifié ; ce port interne
n'accepte pas une identité issue d'un prompt.

## API pour L07

```ts
const manager = new WorkspaceManager(store, serviceActor);
const resources = await manager.reserveResources(1, ['migration:application']);
const workspace = await manager.createWorkspace(
  {
    taskId,
    attemptId,
    mode: 'code',
    baseRevision: 'git:<SHA complet>',
    resources,
  },
  'operation:workspace',
);
const delivery = await manager.collectDelivery(
  workspace.operationId,
  {
    writePaths: ['src/**', 'tests/**'],
    excludedPaths: ['.env'],
  },
  'operation:delivery',
);
const candidate = await manager.prepareIntegration(
  {
    targetRef: 'refs/heads/avity-crew-delivery',
    expectedBase: 'git:<SHA complet>',
    deliveryOperationIds: [delivery.operationId],
    checks: [{ id: 'check:test', command: ['npm', 'test'], timeoutMs: 60000 }],
  },
  'operation:candidate',
);
// L07 fait relire le candidat identifié, puis autorise la promotion.
const promotion = await manager.promoteIntegration(
  candidate.operationId,
  'operation:promotion',
);
```

`inspectRepository(cwd)` restitue racine réelle, répertoire Git commun, HEAD,
branche et changements, y compris les chemins de renommage. Les noms Unicode,
espaces et séparateurs NUL de Git ne passent pas par un shell. Les commandes
longues sont bornées ; un résultat Git tronqué est refusé au lieu d'être parsé.

La base est un commit complet explicite. Un dépôt utilisateur sale reste intact :
aucun stash, reset, clean ou commit de son dossier n'est lancé. Chaque tentative
de code reçoit une branche et un worktree sous le namespace de données du projet.
Le record Workspace et l'opération conservent tâche, tentative, chemin, branche,
base et ressources attribuées.

## Livraison immuable et périmètre

`collectDelivery` vérifie à la fois le périmètre demandé et celui de la TaskSpec
persistée. Les chemins hors périmètre ou exclus provoquent `OUTSIDE_SCOPE` sans
supprimer les fichiers. Les chemins simples désignent un fichier ou un dossier ;
les globs utilisent `path.matchesGlob` de Node.

L'index du worktree de l'agent est capturé en arbre, puis en commit snapshot dont
le parent est la base enregistrée. Les commits intermédiaires de l'agent sont
ainsi inclus dans un seul delta ; aucune intention ne dépend du dernier commit
seul. Une ref `refs/avity-crew/deliveries/...` conserve ce snapshot. Les fichiers
du worktree et sa branche ne sont ni réinitialisés ni écrasés. Toute modification
ultérieure reste dans le worktree et n'altère pas la livraison déjà capturée.
Le rejeu de la même opération restitue son snapshot, sans recapturer ce travail
ultérieur.

## Candidat, revue et promotion

`prepareIntegration` sérialise les écritures d'intégration par projet, crée une
branche/worktree de candidat et applique les snapshots. Le commit de chaque
snapshot appliqué reprend la date de ce snapshot et une identité fixe : mêmes
livraisons sur la même base donnent le même SHA de candidat. Relancer la
préparation avec une nouvelle clé crée un worktree neuf, réexécute préparation
et contrôles, et produit de nouvelles preuves sur ce même SHA ; une revue de ce
candidat reste donc applicable.

`workspace_setup` (configuration projet, optionnelle) liste des commandes
exécutées avec `cwd: "."` dans chaque worktree neuf : celui de l'agent à sa
création, puis celui du candidat avant les contrôles (`npm ci` par exemple).
L'agent n'a ainsi pas besoin de droits d'installation. Un échec dans le worktree
de l'agent refuse sa création (`WORKSPACE_SETUP_FAILED`, tâche bloquée) ; dans le
candidat, il le rend `validation_failed` sans lancer les contrôles. Ces
observations sont conservées à part (`candidate.setup`) : elles ne deviennent pas
des vérifications de critères. Leurs fichiers doivent être ignorés par Git, sinon
le candidat a des changements et échoue. Une branche de livraison
encore absente est créée depuis la base explicite avec comparaison atomique.
Chaque contrôle reçoit le dossier du candidat ; la preuve contient le SHA exact,
argv, dates, code de sortie, signal et sortie expurgée/bornée. Un contrôle qui
échoue, change HEAD ou laisse des changements suivis/non ignorés rend le candidat
`validation_failed`.

Un conflit retourne `conflict`, les chemins en conflit, le dossier du candidat,
les livraisons et la base. L07 crée alors une mission de résolution avec ces
références. Les sources, l'index conflictuel et les deux contributions restent
conservés ; aucun abort/reset automatique ne supprime les intentions.

Seul un résultat de préparation persisté `validated` permet la promotion. L07
place sa revue indépendante et ses règles d'acceptation entre les deux appels.
La promotion utilise la base attendue pour le compare-and-swap de la ref. Une
branche avancée extérieurement impose un nouveau candidat et de nouvelles preuves.
Une cible checkoutée est refusée explicitement : L07 choisit par défaut une
branche de livraison dédiée non checkoutée, ou une ref sous `refs/avity-crew/`.
Il ne doit pas annoncer que le dossier principal de l'utilisateur a été avancé.
Les commandes Git externes qui changent les checkouts doivent être coordonnées
avec cette phase ; les verrous applicatifs ne bloquent pas toutes les commandes
Git qu'un autre outil pourrait lancer.

## Interruption et réconciliation

Chaque cycle externe persiste une intention avec `beginOperation`, puis son
résultat avec `observeOperation`. Une préparation validée et sa promotion sont
deux opérations distinctes. Fermer le service entre elles ne touche pas la ref
stable. Si Git a déjà effectué la promotion mais que la réponse SQLite manque,
le rejeu observe la ref égale au candidat et enregistre l'issue sans réappliquer
la livraison. Un résultat inconnu ne devient pas un succès sur la seule sortie
d'un processus.

Si l'arrêt survient au milieu de la construction du candidat, le dossier partiel
est conservé et le rejeu retourne `RECONCILIATION_REQUIRED`. Le superviseur doit
inspecter le dossier, les refs, l'opération et les processus avant une résolution
ou une nouvelle préparation. Il ne supprime pas ce dossier pour tenter sa chance.
Le verrou d'intégration conserve PID, nonce, run et clé ;
`recoverIntegrationLock()` refuse un propriétaire vivant. Sa récupération est une
action explicite du contrôleur de reprise, après constat de sa mort et inspection
de l'opération incertaine. Un seul contrôleur de reprise administre cette phase.

## Ressources et nettoyage

`reserveResources` tient de vrais sockets sur `127.0.0.1`, alloue un dossier
temporaire privé et un chemin SQLite distinct, et réserve atomiquement les noms
exclusifs demandés. Passer le lease à `createWorkspace` enregistre ports et dossier
dans le Workspace. Les processus restent soumis aux permissions natives : ces
réservations ne sont pas une sandbox.

Le service libère le lease juste avant que l'application reprenne ses ports,
puis vérifie son démarrage. Après libération, le lease ne garantit plus leur
disponibilité ; il ne faut pas annoncer qu'une application écoute avant de
l'avoir observé. `release()` est idempotent, ferme les sockets et libère les
réservations nommées, mais conserve les fichiers et bases temporaires. Après mort
du service, les verrous nommés restants sont inspectés et retirés explicitement
par le contrôleur de reprise ; leur présence ne justifie pas une réattribution
silencieuse.

`cleanupWorkspace(workspaceOperationId, deliveryOperationId, promotionOperationId,
key)` exige la livraison exacte incluse dans le candidat promu et encore retenue
par la ref cible et l'arrêt observé de la tentative exécutante. Il refuse tout travail ultérieur, fichier non suivi ou ignoré,
ou index différent du snapshot. Il retire seulement le worktree de tâche ; la
branche et la ref de livraison restent comme sauvegarde Git. Si le retrait Git a
déjà réussi avant interruption, le rejeu constate son absence et termine sans
double suppression. Un workspace non intégré reste conservé : le capturer et
l'intégrer, ou décider explicitement de son archivage avant toute suppression.

Les dossiers de candidats sont conservés pour inspection et résolution. Leur
retrait administratif utilise un `git worktree remove <chemin exact>` explicite
après vérification de leur état et des refs conservées ; ne pas employer une
suppression récursive ou un prune global. Sauvegarder le dépôt Git et ses refs en
plus de la sauvegarde SQLite : celle-ci n'emporte pas les workspaces Git.

## Sans Git

Les modes `documentation` et `read-only` travaillent dans le dossier courant
réel, sans branche artificielle ni initialisation implicite. Une livraison
documentaire demande `documentPaths` explicites, vérifie le périmètre et la portée
réelle des fichiers, puis stocke leurs snapshots par empreinte. Une modification
ultérieure du document ne change pas ces artefacts. Le dossier utilisateur n'est
jamais retiré par le nettoyage.

`initializeRepository({ authorized: true, createEmptyBaseline: true }, key)` est
réservé à une demande d'initialisation explicite. Le baseline vide utilise un
arbre vide et ne committe pas les fichiers utilisateur ; un index déjà rempli
est refusé. Aucun provider ou credential n'est invoqué par ce module.

## Validation

Les tests utilisent de vrais dépôts jetables et SQLite : deux changements
compatibles, conflit, combinaison invalide malgré sources valides isolément,
branche avancée, cible checkoutée, dépôt sale, snapshots et scopes, reprise de
promotion/nettoyage après réouverture du Store, ports occupés, accès exclusifs,
documents sans Git et initialisation explicite. Un enfant réel est tué par
SIGKILL pendant le contrôle du candidat ; le replay conserve ce candidat partiel.
Ces tests ne sont pas des essais fournisseurs live. Linux/WSL et la CI distante
ne sont pas déclarés vérifiés par la seule recette macOS locale.
