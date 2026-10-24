# Stockage local

`identifyProject(cwd, dataHome?)` résout les liens symboliques et utilise le
répertoire Git commun pour l'identité des worktrees. Sans Git, le chemin réel
du dossier est l'identité. Chaque projet possède un namespace privé sous
`$XDG_DATA_HOME/avity-crew` ou `~/.local/share/avity-crew`.

`Store(project)` ouvre `state.sqlite`, active clés étrangères, synchronisation
complète et délai de verrouillage. Les migrations numérotées s'exécutent sous
transaction exclusive d'écriture ; une version inconnue est refusée. Le fichier
et les artefacts sont privés (0600), le répertoire 0700. Le superviseur L07
sera le writer logique et dérivera Actor du canal authentifié : ce module n'est
pas un endpoint RPC et ne donne pas d'autorité à une identité issue d'un prompt.

Le mode de journal SQLite par défaut est conservé. Le démarrage ne convertit pas
le journal pendant qu'une autre connexion ouvre la base ; le service possède un
seul writer et n'a pas besoin de cette conversion pour garantir les transactions.

Les opérations publiques créent runs/tâches, attribuent et révoquent les
tentatives, observent les processus/sessions, conservent livraisons, décisions,
sources, contexte, espaces de travail, messages, preuves et intentions d'effets
externes. Chaque mutation reçoit Actor, une clé d'idempotence et la version
attendue du run. La transition, son événement et la réponse dédupliquée sont
commis ensemble. Une clé réutilisée avec un contenu différent est refusée.
Le contrôle de portée/génération précède aussi le retour d'une réponse rejouée.

`claimTask` réserve sans attendre le processus. Une tentative `queued` doit être
observée `running` par le superviseur avant de livrer. Une expiration de heartbeat
est un diagnostic : `overdueAttempts` ne réattribue rien. `reassignTask` exige
une tentative précédente observée `exited` ou `interrupted`. Les anciennes
générations ne peuvent plus soumettre. La fin d'un processus n'accepte aucune
tâche et `updateRunStatus` refuse de contourner les preuves de clôture. Les règles
complètes de revue/intégration/acceptation sont complétées avec L06/L07.

`events(runId, afterSeq, limit)` relit le journal par séquence monotone propre au
run, avec 1 à 1000 événements par page. Une nouvelle lecture peut inclure des
événements commis entre deux pages. Les messages distinguent queued, delivered,
acknowledged, applied et failed ; seul un constat fait avancer leur état.
`exportMarkdown` est une projection expurgée, jamais une source d'autorité.

`writeArtifact` publie un fichier complet par renommage, nommé par son SHA-256.
Le mode d'expurgation est explicite pour les logs ; le code source n'est pas
transformé. `readArtifact` vérifie empreinte, portée et liens symboliques.
`backup(destination)` crée une sauvegarde SQLite cohérente et copie les artefacts
immuables dans le sous-dossier artifacts voisin. Le chemin de destination doit
être absent ; une erreur laisse un résultat à examiner, jamais un succès.
Les workspaces Git et conversations natives ne sont pas sauvegardés par cette
opération. Conserver leurs références et appliquer les procédures L06/L10.

Après un arrêt brutal, rouvrir la base sans la réinitialiser, lire les événements,
`uncertainOperations` et `overdueAttempts`, puis observer processus, artefacts et
Git avant de reprendre un effet. Une intention commise n'est pas une réussite.
Les tests utilisent SQLite sur disque et deux processus réels, y compris une
transaction interrompue par SIGKILL ; aucun fournisseur n'est requis.
