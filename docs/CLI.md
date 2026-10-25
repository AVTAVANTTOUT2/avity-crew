# CLI Avity Crew

La commande s'exécute depuis le projet à traiter ; son dossier d'installation ne détermine jamais le workspace. `--project chemin` permet de choisir explicitement un autre dossier. Les chemins avec espaces restent des arguments distincts, sans construction de commande shell.

## Démarrer et créer un objectif

```sh
avity-crew init
avity-crew doctor --json
avity-crew run "Ajouter un export lisible" --criterion "L’export respecte le format demandé" --constraint "Ne rien publier" --chief codex --mode code
avity-crew run --prompt-file "mission avec espaces.md" --criterion "Les tests de recette passent" --mode documentation
cat mission.md | avity-crew run - --criterion "Le document demandé est livré"
```

`run` exige un objectif et au moins un critère explicite. Répéter `--criterion` et `--constraint` pour en fournir plusieurs. `--chief claude|codex`, `--model ID`, `--max-agents N` (1 à 64) et `--mode code|documentation` sont transmis au superviseur ; leur acceptation dépend des capacités réelles. L'interface n'annonce aucune authentification ou recette provider sur la seule réussite d'une commande.

Dans un nouveau dossier, Git n'est initialisé pour du code qu'avec `run ... --init-git`. Le mode documentation n'initialise jamais Git implicitement et refuse cette option. Sans argument dans un terminal, Avity Crew ouvre l'interface plein écran : il rejoint le run actif ou présente l'accueil avec le formulaire « Nouvelle session » (objectif multiligne, critères observables, contraintes, chef, modèle, mode, agents max). Ce formulaire passe par le même analyseur que `run` ; un champ vide conserve la configuration, sans imposer un modèle. Hors terminal, l'absence d'argument affiche l'aide sans démarrer de service.

`init` et `service start` créent/rejoignent les métadonnées et le service ; ils ne créent pas d'objectif et ne lancent aucun modèle. `doctor` consulte le diagnostic du service, démarré si nécessaire, sans créer de run. Les options sont analysées avant toute création de métadonnées ou processus ; un usage invalide ne déclenche aucune mutation de projet.

## Consulter et intervenir

```sh
avity-crew status --run run:ID --json
avity-crew list --json
avity-crew attach --run run:ID --after-seq 42
avity-crew watch --run run:ID --once --json
avity-crew watch --run run:ID --timeout 30000 --json
avity-crew answer --run run:ID --question question:ID "Réponse liée à cette question"
avity-crew message --run run:ID --to chief --kind correction "Précision ciblée"
avity-crew message --run run:ID --to task:ID "Information pour cette tâche"
avity-crew pause --run run:ID
avity-crew resume --run run:ID
avity-crew stop --run run:ID
avity-crew replace-chief --run run:ID --provider claude --model ID
avity-crew reassign --run run:ID --task task:ID
avity-crew inspect-context --run run:ID --subject task:ID --json
avity-crew export --run run:ID --format markdown
```

Les réponses affichent le résultat observé du service. Un enregistrement `queued` n'est pas une réception : `delivered`, `acknowledged` et `applied` gardent leurs sens distincts. Une commande de pause/arrêt ne prétend pas que tous les processus sont déjà terminés. Elle attend que les tours arrêtés aient fini leurs contrôles de sortie (vérification documentaire comprise) ; si cette fin n'est pas observée à temps, elle répond `CONTROL_IN_PROGRESS`, aucun nouveau tour ne démarre et la pause ou l'arrêt s'applique dès la fin observée. `message` utilise le même ToolCall `send_message` que le domaine/MCP, avec version actuelle du run, request_id et idempotency_key explicites ; `chief` désigne `chief:current`, résolu par le serveur.

`status` accepte `--after-seq N` et `--limit N` (1 à 1000). Le viewer réutilise son curseur lors d'une reconnexion et ne crée jamais un nouveau run. Il n'avance le curseur qu'après présentation d'une page. En mode humain, les grandes pages sont résumées et signalent comment obtenir leur contenu complet en JSON. Les tâches, sessions, capacité configurée, dépendances, questions, blocages, décisions et vérifications sont distingués ; le contexte indique une estimation lorsqu'elle existe, et l'usage réel est indiqué indisponible tant qu'il n'est pas fourni. Aucun pourcentage n'est inventé.

Sans `--run`, `status`, `watch` et `attach` observent le run non terminé le plus récent, ou à défaut le dernier créé ; `avity-crew` seul rejoint ce run en cours, sinon ouvre l'accueil. La vue se fixe ensuite sur le run observé et ne bascule pas vers un objectif créé ailleurs ; la colonne Sessions (Ctrl+B, Ctrl+P/Ctrl+N) permet de changer explicitement d'objectif. Les compteurs de tours actifs/en file viennent du scheduler et restent distincts des sessions connues. Les tokens ne sont affichés comme usage déclaré que lorsqu'un événement live les fournit, sans total ou coût facturé inventé.

### Interface plein écran

La vue terminal utilise l'écran alternatif, un rendu ligne à ligne sans effacement global et le décodeur clavier de Node (collage encadré compris) ; aucune dépendance n'a été ajoutée. Les couleurs suivent `COLORTERM` (24 bits) ou la palette 256 couleurs et respectent `NO_COLOR` ; chaque état garde un symbole et un texte (● en cours, ◌ attente, ✓ réussite, ✗ échec, ■ bloqué, ‖ pause, ⊘ annulé), et la sélection une bordure épaisse.

Elle lit uniquement des capacités existantes : `status` (curseur `after_seq`), `list_runs`, `doctor`, l'outil `get_status` en lecture (messages, délégations, réponses) et `export` JSON lorsque des comptes rendus ou revues apparaissent. Les actions utilisent `create_run`, `send_message`, `answer`, `pause`, `resume`, `stop`, `replace_chief` et `reassign`, avec confirmation pour les actions définitives ou de remplacement.

- **Activité** : chef (fournisseur, modèle, état, dernière réponse, décision, délégations) puis un panneau par tâche réelle. Les actions viennent des événements `provider.tool` : commandes et codes de sortie, lectures, fichiers créés/modifiés et extraits de diff `+`/`-` lorsque Claude Code les transmet ; Codex ne fournit pas le contenu du diff, ce qui est indiqué. « terminé » reprend le statut déclaré du compte rendu, « testé » les vérifications déclarées, « validé » l'acceptation par le moteur.
- **Carte** : chef au centre, agents autour, liaisons issues des délégations et des messages réels ; un marqueur bref n'apparaît qu'après un échange enregistré depuis moins de 15 s. Le journal distingue `enregistré`, `transmis`, `reçu` et `prise en compte déclarée`. Sur un petit terminal, une arborescence remplace la disposition radiale.
- **Conversation** : messages de l'utilisateur, réponses du chef, questions et réponses liées, décisions, comptes rendus et blocages. L'historique conserve la position de lecture lorsque de nouveaux messages arrivent.

La palette `/` affiche pour chaque entrée la valeur actuelle, la cible (chef, session, projet, interface) et la prise d'effet. `/provider` et `/model` remplacent le chef via `replace_chief` ; `/effort` (« puissance ») est désactivé car le moteur ne transmet aucun effort aux CLI ; `/permissions` affiche le profil du projet en lecture seule (modification par configuration puis redémarrage du service). Un refus de permission observé est présenté comme un fait accompli : le moteur n'expose aucune approbation interactive.

Dans une vue terminal : `q`, `:q` ou `/quit` détachent ; Ctrl+C interrompt seulement l'affichage. `/answer question:ID texte` répond à une question (hors vue : `avity-crew answer --run ID --question question:ID "texte"`) ; `/compose` rappelle que la saisie est déjà multiligne (Alt+Entrée ou Ctrl+J) et `/cancel` efface le brouillon. Les chaînes d'agents sont nettoyées des contrôles ANSI/OSC et découpées par graphèmes Unicode. Les événements et journaux complets restent dans le service ; l'interface garde au plus 4000 événements par session en mémoire.

Une vue terminal reste ouverte sur un résultat final jusqu'au détachement explicite ; une vue non interactive se termine à l'état final ou après `--timeout MS`. Sans timeout, `watch` reste attaché ; `--once` réalise une seule observation. Le service continue après fermeture de la vue, tant que la machine reste allumée. L'ouverture directe d'une session native n'est pas simulée par l'interface.

Alias : `switch-chief` → `replace-chief`, `context` → `inspect-context`, `report` → `export`, `bridge` → `internal mcp`.

## Service et interfaces internes

`service start`, `service status`, `service stop` commandent le service local. La CLI lance si nécessaire `node <package>/dist/packages/supervisor/src/main.js --project <racine>` en processus détaché, avec sortie append dans `service.log` privé. Aucun objectif ni capability n'est transmis par argv ou journal de lancement. Les variables de capability de session sont retirées de cet enfant service. Le démarrage attend un endpoint sain environ 10 secondes ; le verrou O_EXCL du transport décide de l'instance unique. Deux démarrages concurrents se rejoignent via l'endpoint, sans rejouer `create_run`.

Les commandes utilisateur lisent uniquement `owner.key` privé pour authentifier leur client. `internal call` lit un ToolCall JSON UTF-8 borné sur stdin et utilise `AVITY_CREW_ENDPOINT_FILE` + `AVITY_CREW_CAPABILITY`, sans lire owner.key ou reconnaître le cwd. `internal mcp` réutilise `runMcpFromEnv` et ajoute `AVITY_CREW_RUN_ID` ; stdout reste exclusivement JSON-RPC MCP. Ces entrées n'acceptent pas de capability par option.

Le client relit les métadonnées d'endpoint à chaque requête. Une déconnexion peut laisser une issue métier inconnue ; la CLI ne rejoue pas automatiquement une mutation. Utiliser l'état durable et conserver la clé d'idempotence des appels internes. Le viewer ne tue jamais le service ou ses agents lorsqu'il se détache.

## Sorties et codes

`export --json` sans `--format` produit le rapport JSON complet ; `--format markdown --json` enveloppe le Markdown. `--json` produit `{schema_version:1,ok:true,data:...}` ou `{schema_version:1,ok:false,error:{code,message}}`. `watch --json` produit une telle enveloppe par observation ; une déconnexion transitoire conserve `ok:false` avec `retrying:true` pendant la reconnexion. Le flux MCP interne suit son protocole distinct. Les messages humains vont sur stderr en cas d'erreur et aucun ANSI n'est imposé aux scripts.

| Code | Sens                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| 0    | Requête exécutée/état lu, ou objectif `completed` observé par watch ; un `run` enregistré n'est pas une preuve de fin |
| 1    | Commande échouée ou objectif `failed` observé                                                                         |
| 2    | Usage, options ou entrée contractuelle invalides (fichier objectif absent, mode code sans Git ni `--init-git`)        |
| 3    | Service indisponible, authentification locale refusée, métadonnée privée invalide ou service non construit            |
| 4    | Vue détachée/délai sur objectif non vérifié ou encore en attente                                                      |
| 5    | Vue bornée observant une attente utilisateur                                                                          |
| 130  | Interruption locale de vue ou objectif annulé observé                                                                 |

## Vérification et périmètre

`npm run build`, puis `node --test dist/tests/cli.test.js`. Les tests lancent la vraie CLI dans un autre cwd, un service détaché de test, de vrais sockets HTTP/SQLite et trois parcours PTY : événements/redimensionnement/saisie Unicode puis q, Ctrl+C, formulaire d'accueil avec collage multiligne et attachement au run créé. `node --test dist/tests/tui.test.js` vérifie le rendu (tailles d'écran et d'équipe, carte, palette, encarts) et le routage des actions avec des données explicitement simulées. Les callbacks sont explicitement fake ; ces tests ne prouvent aucune collaboration LLM réelle. Python POSIX est utilisé seulement par le test PTY, pas par le produit.

Le service runtime, les transitions métier, les contrôles d'autorité et la recette réelle relèvent du superviseur intégré. La CLI appelle ces interfaces sans recréer une logique d'orchestration. Les pièces de contexte/export doivent être présentes dans l'état du service ; l'interface n'en invente pas lorsque le fournisseur ou une preuve manque.
