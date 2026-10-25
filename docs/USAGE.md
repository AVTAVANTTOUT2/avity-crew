# Utiliser Avity Crew

Exécuter `avity-crew` depuis le projet, ou ajouter `--project "/chemin/projet"`.
La [configuration](INSTALLATION.md#configuration-avant-le-premier-lancement)
éventuelle est relue au démarrage du service, sans modifier les choix déjà
enregistrés dans les runs. Un changement de fichier nécessite son redémarrage.

## Démarrer un objectif vérifiable

```sh
avity-crew init
avity-crew doctor --json
avity-crew run "Ajouter un export CSV des factures" \
  --criterion "L'export contient une ligne par facture autorisée" \
  --criterion "Les tests couvrent le refus d'une facture d'un autre compte" \
  --constraint "Conserver les contrôles d'accès existants" \
  --chief codex --max-agents 2 --mode code
```

Le dossier doit déjà posséder une révision Git. Dans un **nouveau** dossier sans
Git, ajouter `--init-git` autorise explicitement l'initialisation et la base de
travail. Avity Crew préserve les modifications présentes ; un dépôt sale, une
base déplacée ou une cible de livraison checkoutée peut nécessiter une action
explicite plutôt qu'une réinitialisation automatique.

Pour produire des documents sans créer de dépôt :

```sh
avity-crew run "Rédiger le guide d'accueil du projet" \
  --criterion "Le document précise le public, les prérequis et une procédure testable" \
  --constraint "Utiliser uniquement les sources du projet et signaler les inconnues" \
  --chief claude --mode documentation
```

`run` exige au moins un `--criterion` explicite et accepte plusieurs
`--constraint`. Il démarre des sessions natives et consomme leurs ressources.
Le mode documentation travaille dans le dossier partagé, sérialise ses writers
et capture des fichiers par empreinte ; il ne demande pas d'initialisation Git.
`--init-git` y est refusé.

Un fichier ou stdin convient aux objectifs longs :

```sh
avity-crew run --prompt-file "mission détaillée.md" \
  --criterion "Les livrables répondent aux points vérifiables de la mission" \
  --mode documentation
cat "mission détaillée.md" | avity-crew run - \
  --criterion "Le document demandé est livré et relu" --mode documentation
```

`--chief claude|codex` choisit le chef, `--model ID` un modèle accessible et
`--max-agents N` la limite du run, chef compris. Cette limite ne peut pas dépasser
la capacité configurée du service. Une place autorise la progression séquentielle ;
sept places configurées ne constituent pas une recette de charge réussie.
`init` et `service start` ne lancent aucun modèle. `doctor` inspecte les CLI sans
créer d'objectif ; sa réussite ne prouve pas un tour LLM ou la disponibilité d'un quota.

## Conversation et suivi

Dans un terminal, `avity-crew` sans argument ouvre l'interface plein écran :
elle rejoint l'objectif actif, ou affiche l'accueil (logo AVT et formulaire
« Nouvelle session » : objectif multiligne, critères, contraintes, chef, modèle,
mode et nombre d'agents). Hors terminal, cette commande affiche l'aide. `run` et
`attach` en terminal ouvrent la même interface sur le run concerné ; conserver
son ID pour le suivre depuis un autre terminal :

```sh
avity-crew list --json
avity-crew status --run run:ID --json
avity-crew attach --run run:ID
avity-crew watch --run run:ID --once --json
avity-crew watch --run run:ID --after-seq 42 --timeout 30000 --json
```

Remplacer `run:ID`, `task:ID` et `question:ID` par les identifiants effectivement
renvoyés. Une vue reste attachée au run sélectionné lors de ses reconnexions.
Le curseur `after_seq` sert à relire les événements suivants ; le viewer ne crée
pas de second objectif. `status --limit N` borne sa page, pas une preuve de
présence de tous les éléments du chantier.

L'interface présente trois vues (Tab pour passer de l'une à l'autre) :

- **Activité** : le chef en haut (fournisseur, état, dernière réponse,
  décision, délégations), puis une mosaïque d'un panneau par agent réel (deux
  colonnes si la largeur le permet) : mission, état, commandes et résultats,
  fichiers et extraits de diff fournis par la CLI, compte rendu, et la ligne
  « terminé / testé / validé ». Entrée agrandit l'agent sélectionné ; Échap
  revient à la mosaïque.
- **Carte** : le chef au centre, les agents autour, et le journal
  « heure · émetteur → destinataire · résumé » avec le statut de transmission.
  Un petit terminal affiche une arborescence à la place.
- **Conversation** : messages, réponses du chef, questions, décisions et
  comptes rendus, avec l'émetteur et le destinataire.

| Entrée                       | Action                                                        |
| ---------------------------- | ------------------------------------------------------------- |
| Texte puis Entrée            | Envoyer au destinataire affiché (chef par défaut)             |
| Alt+Entrée ou Ctrl+J         | Nouvelle ligne ; un collage multiligne reste un brouillon     |
| Entrée sur une saisie vide   | Agrandir l'agent ou le chef sélectionné                       |
| ↑ ↓ ← → sur une saisie vide  | Sélectionner un agent ou défiler l'historique                 |
| PgPréc, PgSuiv, Début, Fin   | Parcourir l'historique sans retour forcé en bas               |
| `/`                          | Palette : `/provider`, `/model`, `/effort`, `/permissions`, … |
| Ctrl+T                       | Destinataire : chef, agent sélectionné ou question ouverte    |
| Ctrl+B ; Ctrl+P / Ctrl+N     | Colonne Sessions ; session précédente / suivante              |
| `/answer question:ID texte`  | Répondre à cette question                                     |
| `q`, `:q`, `/quit` ou Ctrl+C | Détacher la vue, laisser le service travailler                |

Chaque session conserve son brouillon, sa sélection et sa position de lecture.
Les mises à jour ne déplacent ni le texte saisi ni le curseur. Une question du
chef ou un refus de permission observé apparaît dans un encart au-dessus de la
saisie. Les tâches, les sessions connues, les tours actifs et les tours en file
sont distincts. Aucun pourcentage, coût ou durée n'est affiché ; les tokens ne
sont montrés que lorsqu'un événement live les déclare.

Une vue TTY attend le détachement même après un résultat final. Hors terminal,
`watch` se termine à un état final ou au délai demandé ; `--once` lit un seul état.
Les sorties `--json` utilisent une enveloppe `schema_version`, `ok`, `data` ou
`error`. Le [tableau des codes de sortie](CLI.md#sorties-et-codes) distingue
commande réussie, attente, détachement et objectif annulé. Une réponse `ok:true`
à `run` signifie que l'objectif a été enregistré, pas qu'il est terminé.

## Questions, corrections et commandes de contrôle

```sh
avity-crew answer --run run:ID --question question:ID "Conserver le format CSV UTF-8"
avity-crew message --run run:ID --to chief --kind correction "Ajouter le cas d'accès refusé"
avity-crew message --run run:ID --to task:ID "La source de référence a changé"
avity-crew pause --run run:ID
avity-crew resume --run run:ID
avity-crew replace-chief --run run:ID --provider claude
avity-crew reassign --run run:ID --task task:ID
avity-crew stop --run run:ID
```

Une réponse à une question est rattachée à son identifiant ; un message libre ne
la clôt pas. Les états `queued`, `delivered`, `acknowledged`, `applied` et `failed`
restent distincts : une mise en file ne prouve pas une lecture ni une application.

`pause` permet une reprise ; `stop` annule le run, qui ne peut pas être repris
comme s'il était seulement en pause. `replace-chief` remplace l'autorité du chef,
conserve l'état durable et choisit une nouvelle génération ; la mémoire privée
d'une conversation Claude n'est pas transférée magiquement à Codex. `reassign`
nécessite une ancienne tentative arrêtée ou réconciliée. En cas d'issue ambiguë,
la commande peut refuser plutôt que d'accorder deux propriétaires au même travail.

Pendant une pause ou un arrêt, les nouveaux lancements et réveils en file sont
bloqués jusqu'à la fin observée des tours concernés. L'état final de contrôle
n'est enregistré qu'après cette observation. `CONTROL_IN_PROGRESS` signifie
qu'une autre commande de contrôle doit d'abord se terminer ; relire le statut
avant de réessayer.

Le chef peut corriger une mission avec l'outil interne `amend_task`, après une
décision approuvée couvrant la tâche. Il fournit la TaskSpec complète, la raison
et l'ID de décision. Le service conserve les spécifications avant/après et
l'auteur authentifié dans une révision auditée, puis change la génération de la
tâche. Les anciennes tentatives doivent être arrêtées ou réconciliées ; les
anciennes autorités et passations ne deviennent pas valides pour le nouveau
plan. L'objectif, les contraintes et les critères globaux du run restent inchangés.
Une correction envoyée par message ne constitue donc pas à elle seule un plan
amendé. Voir les [gardes de stockage](STORAGE.md#correction-du-plan-et-résultats-de-contrôle).

```sh
avity-crew service status --json
avity-crew service stop
avity-crew service start
```

Ces commandes concernent le service du projet. Certaines lectures démarrent ou
rejoignent le service si nécessaire ; `service status` n'est pas un simple test
de présence de PID. L'arrêt du service interrompt ses tours, sans équivaloir à
`stop` pour chaque objectif. Fermer la vue ou son terminal n'arrête pas le service.
Après un redémarrage du service ou de la machine, suivre la reprise explicite.

## Inspecter le contexte et les preuves

```sh
avity-crew inspect-context --run run:ID --subject task:ID --json
avity-crew inspect-context --run run:ID --subject control:run:ID --json
avity-crew export --run run:ID --format markdown > "rapport de run.md"
avity-crew export --run run:ID --format json --json > "rapport de run.json"
```

Le sujet du chef est `control:` suivi de l'ID complet du run. Le contexte expose
sources, versions, raisons, couches et budget ; un contexte insuffisant, une
source manquante ou une omission doit rester explicite. `status` affiche des
résumés de contexte ; l'inspection ciblée conserve le détail enregistré.

Les exports contiennent tâches, décisions et preuves observées. Le JSON expose
une page d'événements avec `event_page_size` ; le Markdown est une projection,
pas une sauvegarde ni une archive exhaustive du journal. Pour davantage
d'événements, paginer `status --after-seq ... --limit ... --json` jusqu'à la page
vide. Relire les rapports avant de les partager, même lorsque les secrets connus
sont expurgés : le contenu du projet peut rester privé.

La fin native d'un tour, une phrase « terminé » ou un test simulé vert ne suffit
pas à accepter une tâche. La livraison doit référencer le snapshot, la revue
indépendante et les contrôles de la révision concernée.

En mode documentation, l'agent peut soumettre `document_paths` avec des chemins
relatifs de fichiers présents dans son scope. Le service capture les octets,
calcule leurs empreintes et conserve les preuves. L'agent peut laisser
`artifacts: []`, `verifications: []` et `source_revision: null` dans cette entrée ;
il ne doit pas inventer un hash ou déclarer un test exécuté. Le Handoff conservé
est ensuite celui de la capture, soumis aux contrôles habituels.

Une tâche de contrôle produit une Review sur la livraison actuelle d'un autre
acteur et d'une conversation distincte. Le service conserve le rapport de revue
et sa preuve statique comme `control_result`. Cette preuve n'affirme pas qu'une
commande métier a été exécutée : les commandes configurées gardent leurs propres
résultats et révisions testées. Pour contribuer à la clôture globale, une revue
approuvée doit être utilisée par l'acceptation de la livraison courante. Une
ancienne revue, un avis négatif ou un simple message ne suffit pas. L'[exemple
documentaire](examples/documentation-run.md) distingue écriture, contrôle et clôture.

## Récupérer une livraison de code

Le runtime choisit par défaut une référence de la forme
`refs/heads/avity-crew/delivery-run-…`, ou la cible configurée. Elle doit rester
non checkoutée pendant la promotion. **Votre checkout principal n'est pas avancé.**
Retrouver la référence et le SHA accepté dans les preuves, puis inspecter localement :

```sh
git status --short
git for-each-ref --format='%(refname) %(objectname)' refs/heads/avity-crew/
git diff --stat BASE "$CREW_DELIVERY_REF"
git log --reverse --oneline BASE.."$CREW_DELIVERY_REF"
```

Définir `CREW_DELIVERY_REF` avec la référence observée et remplacer `BASE` par la
base Git enregistrée. Pour examiner les fichiers sans checkout de cette branche,
ouvrir un worktree détaché sur le SHA accepté avec
`git worktree add --detach "/chemin/relecture" SHA_ACCEPTE`.

Après inspection et avec un checkout propre, appliquer **tous les commits utiles**
dans l'ordre, par exemple `git cherry-pick COMMIT_1 COMMIT_2`. Ne pas prendre
seulement le dernier commit d'un candidat composé de plusieurs contributions.
Une avance rapide avec `git merge --ff-only "$CREW_DELIVERY_REF"` convient si
votre branche est bien ancêtre de la livraison. Résoudre les conflits et rejouer
les contrôles sur l'état appliqué ; Avity Crew n'exécute pas ces commandes
d'application ni un push à votre place.

## Reprendre après une interruption

1. Retrouver le projet et l'ID du run avec `list`, puis lire `status --json` et
   les derniers événements. Une déconnexion de vue ne nécessite pas de nouveau run.
2. Distinguer un tour encore vivant, un processus effectivement sorti et une
   opération dont le résultat est inconnu. Un heartbeat ancien ou un silence
   n'est pas une preuve d'arrêt.
3. Utiliser `resume --run ...` pour une reprise explicitement souhaitée. Le
   runtime contrôle les processus enregistrés et conserve les snapshots ;
   `RECONCILIATION_REQUIRED` exige d'inspecter l'identité et le travail conservé.
   Ne pas supprimer les verrous ni tuer un PID sur son seul numéro.

Le fournisseur reprend une conversation uniquement par son ID natif exact quand
la capacité est disponible ; sinon le travail nécessite un nouveau contexte.
Le contexte de reprise distingue l'état courant des livraisons et les nouvelles
mises à jour, avec sources et omissions explicites. Les générations du chef et
des tâches, les tentatives actives et les versions restent vérifiées côté service :
un ancien agent ne récupère pas son autorité parce qu'il possède encore un ancien
prompt ou qu'une requête attendait dans la file.
Une mission Git reprise peut partir de son snapshot partiel. Sa livraison finale
reste cumulative depuis la base assignée à la mission, avec les mêmes contrôles
de scope et d'exclusion. Si une base amendée n'est pas ancêtre du workspace
conservé, `BASE_CHANGED` exige une nouvelle attribution depuis cette base ; le
service conserve les fichiers et ne les rebase pas automatiquement.
Une mutation dont la réponse HTTP s'est perdue peut avoir été exécutée. La CLI
ne la rejoue pas automatiquement : vérifier l'état avant de répéter l'action.
Voir les garanties et limites [POSIX de reprise](RECOVERY.md) et la
[sauvegarde](INSTALLATION.md#données-sauvegarde-et-restauration).

## Outils internes et dépannage

Les agents utilisent le pont MCP stdio ; le fallback `avity-crew internal call`
lit le même ToolCall JSON sur stdin et passe par les mêmes contrôles. L'identité
provient exclusivement de la capability fournie par le service, pas d'un acteur
écrit dans le JSON. `schema_version`, `request_id`, `idempotency_key`, `run_id`,
`expected_version`, `method` et `arguments` doivent respecter le contrat.
Conserver une même clé et un même contenu pour rejouer une mutation incertaine,
et rafraîchir la version avant une nouvelle action.

Ces interfaces reçoivent `AVITY_CREW_ENDPOINT_FILE`, `AVITY_CREW_CAPABILITY` et,
pour MCP, `AVITY_CREW_RUN_ID` via l'environnement préparé par le service. Ne pas
copier `owner.key`, mettre un token dans un prompt/argv ou fabriquer des accès
dans un exemple. `internal mcp` réserve stdout à JSON-RPC. Voir le
[protocole local](PROTOCOL.md) pour le contrat complet.

| Symptôme                                          | Vérification utile                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SERVICE_NOT_BUILT`                               | Réinstaller le tarball construit ; depuis les sources, exécuter `npm run build`                                    |
| `PROVIDER_UNAVAILABLE`, authentification ou quota | Consulter `doctor` et la CLI native ; conserver la trace sans afficher de secrets                                  |
| `GIT_INITIALIZATION_REQUIRED`                     | Fournir une base Git, autoriser `--init-git` pour un dossier neuf, ou choisir documentation                        |
| `VERSION_CONFLICT`                                | Relire le statut et distinguer nouvelle action/rejeu de la même action                                             |
| `IDEMPOTENCY_CONFLICT`                            | Même clé avec contenu différent : examiner le journal ; ne pas générer des clés en boucle pour contourner l'erreur |
| `RECONCILIATION_REQUIRED`                         | Conserver base, worktrees et opérations ; faire constater la propriété et la fin du processus avant réattribution  |
| `CONTROL_IN_PROGRESS`                             | Laisser finir la pause, l'arrêt ou l'autre contrôle en cours, puis relire le statut avant une nouvelle action      |
| Permission native refusée                         | Ajuster la mission ou répondre au besoin réel de permission ; aucun bypass global n'est ajouté                     |
| Vue ou export trop grand                          | Réduire la page d'événements et inspecter un contexte ciblé ; ne pas supprimer les preuves                         |

La [référence CLI](CLI.md) donne les alias et codes de sortie. L'état de
[validation réelle](../README.md#validation-réelle) précise les parcours qui
restent à qualifier ; le succès d'une commande de diagnostic n'en tient pas lieu.
