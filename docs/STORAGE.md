# Stockage local

`identifyProject(cwd, dataHome?)` résout les liens symboliques et utilise le
répertoire Git commun pour l'identité des worktrees. Sans Git, le chemin réel
du dossier est l'identité. Chaque projet possède un namespace privé sous
`$XDG_DATA_HOME/avity-crew` ou `~/.local/share/avity-crew`.

Depuis un sous-dossier Git, root est le sommet du worktree courant. Pour un
dépôt standard, l'identité utilise le parent du répertoire commun `.git` :
initialiser Git dans un dossier nouveau conserve donc son identité durable et
ses runs. Les worktrees liés partagent cette même identité.

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

Les identifiants de tâche sont choisis par le chef et propres à un run : la
clé SQLite est `(run_id, id)` depuis la migration 3, qui reconstruit `tasks`,
`attempts` et `records` sans perte puis vérifie `foreign_key_check` avant commit.
`getTask(runId, id)` ne lit que le run demandé ; un identifiant connu seulement
d'un autre run donne `WRONG_RUN`, et une création en double dans un run
`TASK_EXISTS`. `currentRun()` désigne le run non terminé le plus récent, ou à
défaut le dernier créé : c'est la cible des commandes sans `--run`.

`claimTask` réserve sans attendre le processus. Une tentative `queued` doit être
observée `running` par le superviseur avant de livrer. Une expiration de heartbeat
est un diagnostic : `overdueAttempts` ne réattribue rien. `reassignTask` exige
une tentative précédente observée `exited` ou `interrupted`. Les anciennes
générations ne peuvent plus soumettre. La fin d'un processus n'accepte aucune
tâche et `updateRunStatus` refuse de contourner les preuves de clôture. Les règles
de revue/intégration/acceptation sont décrites ci-dessous.

`events(runId, afterSeq, limit)` relit le journal par séquence monotone propre au
run, avec 1 à 1000 événements par page. Une nouvelle lecture peut inclure des
événements commis entre deux pages. Les messages distinguent queued, delivered,
acknowledged, applied et failed ; seul un constat fait avancer leur état.

L'auteur authentifié reste actor_id ; les champs task_id/attempt_id/session_id
et payload.subject_id identifient séparément la cible de la mutation, y compris
lorsqu'un chef ou l'utilisateur attribue une tâche.
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

## Coordination et autorité

Le service utilise un `Actor` authentifié de rôle `user` pour les observations
du système ; le prompt ne choisit jamais cet acteur. Le chef porte sa génération
du run, sans tâche ni tentative. `registerChiefSession(user, session, key,
version)` conserve une session avec `task_id:null`, fournisseur et modèle du
run. `replaceChief(user, provider, model, key, version)` incrémente la génération
et révoque l'ancienne autorité. Le runtime doit avoir arrêté et observé l'ancien
tour avant cet appel ; un silence ou un heartbeat ne prouve pas cet arrêt.

`delegateTask(chiefOrUser, args, key, version)` persiste un retour `queued`, sans
attendre le fournisseur. Une tâche `waiting_dependency` peut être déléguée et
conserve son attente. Une tâche `changes_requested`, `blocked` ou
`waiting_provider` peut recevoir une nouvelle délégation si son ancienne
tentative est observée `exited` ou `interrupted` ; le service appelle ensuite
`reassignTask` explicitement. `claimTask` vérifie les dépendances et questions,
le fournisseur/modèle délégué puis passe la délégation à `claimed` avec
`attempt_id` dans la transaction de claim. Une nouvelle demande identique ne
crée pas une deuxième délégation en attente.

`publishNote(worker, args, key, version)` et `reportBlocker(worker, args, key,
version)` sont bornés à la tâche et génération courantes. Le blocage est explicite,
avec action requise et sources du même run. Les notes restent des données ; elles
ne deviennent pas des décisions approuvées.

`requestQuestion(chiefOrUser, RequestUserInputArgs, key, version)` conserve
question, options canoniques `{label, consequence}` et tâches affectées. Une
question bloquante ne suspend que ces tâches : une tâche active passe
`waiting_user`, une tâche prête conserve son état mais son claim est refusé.
`respondQuestion(user, questionId, answer, key, version)` conserve une réponse
attribuée à l'utilisateur réel, sa source `user_message` et le lien question,
dans une transaction. Seules les tâches concernées sans autre question ouverte
sont libérées. `recordDecision` accepte un cinquième argument
`{basis, user_response_id}` ; le mode `user_response` exige cette réponse réelle,
sa source et sa portée, avec l'approbateur utilisateur conservé. Le jugement
technique garde l'approbateur authentifié du chef ou de l'utilisateur.
La décision persistée, et retournée à l'appelant, conserve cette provenance dans son champ optionnel
`provenance` : le schéma strict et le compilateur de contexte l'acceptent sans
la supprimer. Les anciens enregistrements sans ce champ restent valides ;
les liens et l'autorité d'une réponse utilisateur restent contrôlés par Store.
La réponse d'une décision `user_response` est exactement celle enregistrée ;
une reformulation du modèle n'est pas attribuée à l'utilisateur. Le service
peut conserver le cwd réellement lancé via `updateSession(..., {cwd, ...})`,
avec un chemin absolu de répertoire existant et sans exposer de capacité en base.

`setTaskWait(user, taskId, status, reason, key, version)` n'autorise que
`waiting_provider`, `waiting_user`, `blocked` ou `failed` et respecte la table
des transitions. Par exemple une tâche encore `ready` ne peut pas prétendre
être un worker déjà en attente de fournisseur.

`observation(user, type, payload, correlation?)` est le seul journal sans
incrément de version du domaine. Il conserve la séquence, l'auteur et les
références validées du run, dans les espaces `provider.*`, `turn.*` ou
`scheduler.*`. Il ne remplace pas les mutations métier.

## Revue, livraison et fin du run

`submitReview(reviewer, Review, key, version)` exige l'affectation courante du
reviewer et le handoff/source courants exacts. Le producteur et le reviewer ont
des acteurs, tâches, tentatives et sessions distincts ; une même conversation
native du même fournisseur ne vaut pas une revue indépendante. Une revue
`source` peut demander une correction avant la création du candidat avec
`tested_revision:null`. Une approbation exige une révision testée, des preuves
passantes et aucun finding bloquant. `changes_requested` et `blocked` sont des
transitions réelles de la tâche livrée. La tâche de contrôle devient `accepted`
avec la Review persistée comme résultat, par les transitions internes
`in_review` puis `validating` ; elle ne crée pas une revue de revue.

`saveVerification(user, taskId, verification, key, version, artifacts = [])`
conserve les preuves du service et leurs snapshots après le handoff immuable.
Une preuve `live`, ici ou déclarée dans un handoff, passe `assertLiveVerification` :
une simulation (`fake`) ne peut pas s'y présenter. Les preuves du service restent
`static`, issues d'une commande réellement exécutée.
Les nouveaux artefacts doivent appartenir à une tentative de cette tâche,
figurer dans la preuve et passer `readArtifact`. Une même métadonnée déjà
conservée peut être réutilisée ; elle ne peut pas être remplacée.

`validateDelivery(chiefOrUser, AcceptDeliveryArgs)` exécute les gardes sans
mutation, événement ni promotion. `acceptDelivery(chiefOrUser, args, key,
version)` refait toutes les gardes après la promotion. Les deux exigent :

- handoff courant `delivered`, sans limitations, tous critères requis revendiqués,
  producteur arrêté et génération encore courante ;
- artefacts canoniques accessibles, empreintes exactes et producteur cohérent ;
- preuves du même task, passantes sur la révision acceptée, avec observation
  immuable ; commande automatisée `exit_code:0`, ou observation documentaire
  manuelle `command:null`/`exit_code:null` ;
- revue indépendante approuvée sur ce handoff, cette source et cette révision,
  sans finding bloquant, avec les preuves citées présentes.

Le code exige `combined_code` sur le candidat exact, une opération persistée
`integration.prepare` complète `validated`, ses checks réels et la livraison
`workspace.collect` de cette tentative. Ses artefacts Git identifient la référence
de préservation source exacte. L'acceptation exige en plus l'opération
`integration.promote` complète sur la même préparation, cible et base attendue.
Le service vérifie aussi Git au port WorkspaceManager : un enregistrement SQL
ne remplace pas l'observation de Git. La séquence est validation Store, promotion
du candidat exact, acceptation Store ; après une issue SQL inconnue, réconcilier
la promotion avant de rejouer l'acceptation avec la même clé.

Le document exige `documentation` et le SHA-256 réel du snapshot exact,
sans référence Git artificielle. Une acceptation conserve les IDs des preuves,
revues et artefacts dans un record `acceptance`, renseigne `accepted_revision`
et rend prêtes les tâches dont toutes les dépendances sont acceptées.

`finishRun(chiefOrUser, FinishRunArgs, key, version)` lie chaque critère requis
aux `evidence_artifact_ids` d'une preuve passante issue d'une livraison acceptée.
Les artefacts finaux doivent appartenir à ces livraisons. Toutes les tâches,
y compris les contrôles, sont acceptées ; aucune question bloquante ou tentative
active/inconnue ne subsiste. La vérification, `running→validating→completed`,
le record `final`, l'événement et la réponse rejouable partagent une transaction.
Un refus ne laisse aucun statut intermédiaire commis. Un exit 0 ou un texte
affirmant le succès ne satisfait pas ces gardes.

## Correction du plan et résultats de contrôle

`amendTask(chiefOrUser, {task, reason, decision_id}, key, version)` remplace une
mission après une décision approuvée qui cite cette tâche, ou porte explicitement
sur tout le run (`affects_task_ids:[]`). L'identité, le run et `created_at` restent
immuables. Les tâches acceptées ou annulées sont refusées. Toutes les anciennes
tentatives doivent être observées `exited` ou `interrupted` et les intentions de
processus fournisseurs associées doivent être réconciliées ; un heartbeat ne
permet pas cet amendement.

Le nouveau DAG est contrôlé, les chemins restent relatifs au projet et les
exclusions de sa configuration sont conservées. Un record `task_revision`
conserve les deux TaskSpec, la raison, la décision et l'acteur authentifié. La
génération de la tâche augmente : les anciennes capacités et livraisons ne
peuvent plus être utilisées, même si le contenu du document reste identique.
Une livraison en revue ou validation passe `changes_requested`. Une tâche prête
peut rester prête ; ses dépendances sont réévaluées. Une tâche arrêtée qui était
encore `running` devient bloquée en attendant la réattribution explicite.
Le runtime utilise ensuite `reassignTask` et une nouvelle soumission. Le run
conserve intégralement son objectif, ses contraintes et ses critères obligatoires.

Les anciens motifs d'attente sont effacés à la réattribution, au claim, à la
livraison complète et à l'amendement lorsqu'ils ne décrivent plus l'état courant.
Une question toujours ouverte demeure une garde de claim/acceptation. Un état
bloqué ou une livraison partielle conserve son motif de blocage.

Chaque `submitReview` valide produit aussi un snapshot canonique de la Review,
un ArtifactRef et une Verification de l'exécution du contrôle, puis un record
`control_result` reliant les IDs de la tâche, de la tentative, de la revue, du
handoff et des preuves. Cette preuve est `static`/`manual`, sans commande ni
exit code, avec le fournisseur de la session reviewer. Elle constate le résultat
réel du contrôle ; elle n'annonce aucune exécution native ni recette live. Le
contrôle accepté ne crée ni tâche de chef ni handoff artificiel de reviewer.
Tous ces records et les transitions du contrôle partagent la transaction de revue.

Pour la clôture, un résultat de contrôle ne fournit des preuves globales que si
sa Review approuvée figure dans les `review_ids` d'une acceptation réelle de la
livraison courante. L'empreinte du snapshot, sa tentative, ses critères et sa
révision testée sont revérifiés. Une revue négative, une ancienne source ou une
revue non utilisée par l'acceptation n'autorise pas la fin du run. Les preuves et
artefacts éligibles des contrôles rejoignent ceux des writers acceptés pour
vérifier `criterion_evidence`, sans retirer de critère global.

## Configuration du service propriétaire

`configureProject(config)` est une opération interne du service, sans API agent.
Le bootstrap l'appelle uniquement après acquisition du verrou de transport du
projet. Elle valide la configuration, ne remplace que `project.config` en
transaction, puis actualise la copie mémoire après commit. Elle n'est pas appelée
par le constructeur. L'identité, les chemins, la version de carte, la date de
création et les runs/tâches sont conservés. Une configuration invalide n'écrit rien.
