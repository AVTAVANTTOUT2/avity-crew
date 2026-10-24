# L07/L08 — Test minimal d'orchestration et gardes

Conception seulement, 2026-10-24, session `l00_acceptance_map`. Aucune exécution L08 ni CLI fournisseur dans cette sous-tâche. Sources : lots L07/L08, schéma runtime, contrats et Store actuels.

## Deux preuves distinctes

1. **Intégration déterministe du vrai moteur** : vrai Store SQLite, vrais ports de coordination/MCP, scheduler réel, Git et commandes de validation réels. Seule la frontière de décision/flux du provider utilise des scripts/fixtures portant `provenance: simulated`. Ne pas remplacer acceptation, planification ou transitions par des mocks.
2. **Recette live ultérieure** : même parcours depuis l'application avec Claude/Codex réels, deux exécutants mixtes utiles, correction et preuves. Puis chef inverse. Les succès du premier niveau ne constituent pas cette preuve live.

## Scénario déterministe minimal

Fixture sans secret : petite bibliothèque Node + CLI. Mission A écrit une fonction ; B écrit l'interface sur un fichier distinct. Un contrat initial fixe les exports. Une vérification indépendante comprend un cas négatif qui détectera le défaut contrôlé de A.

| Étape | Action et assertion indispensable |
|---|---|
| 1 | Créer run et session chef avec `task_id:null`, contexte `subject_kind:control`. Aucun TaskSpec/Attempt factice pour le chef ; seuls A/B et les vrais contrôles entrent dans le graphe. |
| 2 | Configurer `max_active_agents:1`. Pendant son tour, le chef appelle `delegate_task(A)`. Fermer la barrière de fin du worker : la réponse de délégation doit tout de même arriver avec état queued/identité, sans attendre sa livraison. Vérifier cette causalité par barrières, sans seuil de durée fragile. |
| 3 | Tant que le chef reste actif, aucun worker ne démarre. Clore réellement son tour ; A acquiert alors la place. Après sa fin, le chef reprend son identifiant natif ou un contexte de reprise explicite. Reconstituer la courbe des tours actifs depuis les événements et vérifier `max <= 1`, sans compter sessions connues ou tâches `running` comme des tours actifs. |
| 4 | Variante capacité 3 : A/B démarrent sur deux barrières indépendantes ; constater un chevauchement réel de leurs intervalles actifs et aucun dépassement du plafond chef compris. Une tâche avec dépendance non acceptée ne démarre pas. |
| 5 | Faire livrer A avec son défaut. Sans revue/preuve, `accept_delivery` échoue et laisse statut, accepted_revision et ref stable inchangés. Une sortie de processus 0 ou une affirmation du chef ne suffit pas. |
| 6 | Assigner une session de revue distincte au handoff exact. Son `changes_requested` peut précéder un candidat : A devient changes_requested, la mission de contrôle se termine, puis une correction ciblée reçoit nouvelle tentative/contexte. Un retour tardif de l'ancienne génération est refusé. |
| 7 | Produire A corrigé et B, préparer leur combinaison réelle. Le test indépendant passe sur le nouveau SHA ; une revue approuvée liée à ce SHA et les preuves autorisent promotion/acceptation. Les preuves de l'ancienne source restent insuffisantes. Les dépendants deviennent prêts atomiquement. |
| 8 | Poser une question bloquante concernant uniquement A. B continue. Seule une réponse d'un client utilisateur authentifié peut la résoudre ; sa provenance est liée à `question_id`, puis à `record_decision` via `user_response_id` réel. Refuser réponse forgée, autre run, ancien chef et identifiant inexistant. |
| 9 | `finish_run` refuse critère requis sans preuve, livraison non acceptée, question/blocage ouvert ou contrôle encore actif. Après preuves liées aux livraisons acceptées, il clôture sans attendre l'acceptation d'une identité de chef. Fermer/réouvrir le Store et vérifier décisions, rapports et résultat. |

Le parcours documentaire sans Git est un second petit test : `base_revision:null`, snapshots réellement présents et hash vérifié, revue indépendante `documentation`, preuve manuelle `command:null` avec artefact d'observation, acceptation et clôture sans init/commit/merge artificiel.

## Pièges de modèle à éviter

- `AgentSession.task_id:null` et `ContextBundle.subject_kind:control` existent déjà. `Attempt.task_id` est obligatoire : ne pas fabriquer une tâche chef pour satisfaire ce type. Les tours du chef peuvent être journalisés par les opérations existantes `provider.turn` ; ne pas ajouter une seconde attribution métier sans besoin.
- `delegate_task` enregistre puis retourne. Il ne rejoint jamais une Promise de worker en gardant la seule place du chef. Le scheduler réserve/libère ses places aux frontières réelles des tours et réconcilie les processus incertains avant relance.
- Une tâche de revue ne peut pas avoir pour dépendance « tâche relue acceptée » : celle-ci attend précisément sa revue. Lier explicitement le contrôle au handoff/source à examiner, puis rendre la revue prête quand cette livraison existe. Une revue valide clôture sa propre mission de contrôle sans revue de revue infinie ; `changes_requested` ne signifie pas que le livrable original est accepté.
- L'identité/portée vient du canal authentifié, jamais de `review_task_id`, `approved_by` ou d'un rôle envoyé en texte. Une nouvelle identité locale reprenant la même conversation native du producteur n'est pas une revue indépendante.
- Les contrôles d'acceptation précèdent tout avancement de ref. La finalisation SQLite et l'effet Git utilisent une intention persistée/réconciliation ; ne pas assimiler la transaction SQL à une transaction Git.

## Extensions Store strictement nécessaires

Les signatures ci-dessous sont les frontières fonctionnelles, pas une demande de nouvelle abstraction. Tous les chemins de mutation gardent `actor`, clé d'idempotence et `expectedVersion` ; scope, génération et transition sont vérifiés dans la transaction.

| Chemin manquant observé | Données / garde minimale |
|---|---|
| `registerChiefSession(user, session, key, version)` | AgentSession avec `task_id:null`, run/provider cohérents ; aucune TaskSpec/Attempt créée. |
| `delegateTask(chief/user, DelegateTaskArgs, key, version)` | Persister task/provider/model et état queued ; ne pas lancer/attendre le provider dans la transaction. `claimTask`, `observeAttempt`, begin/observeOperation restent réutilisables. |
| `publishNote` / `reportBlocker` | Args canoniques, Actor de la tâche courante ; note proposée distincte de décision approuvée ; blocage ciblé et motif durable. |
| `requestQuestion` / `respondQuestion` | Question `{id,run_id,question,options,affects_task_ids,blocking,status,requested_by,created_at}` ; réponse `{id,run_id,question_id,answer,user_actor_id,created_at}`. Réponse utilisateur seulement. Réutiliser SourceRef `user_message` pour sa provenance ; aucun changement du schéma Decision nécessaire pour la seule source. |
| `recordDecision` avec provenance | Vérifier `basis:user_response` et une vraie réponse du même run avant approbation, puis conserver son lien source et l'approbateur réel. Étendre le chemin existant ; ne pas créer un mode parallèle permettant de contourner l'adoption. |
| Liaison de revue + `submitReview(reviewer, Review, key, version)` | Liaison serveur stricte review_task ↔ handoff/source ; auteur actif distinct du producteur ; source/combinaison/doc et résultat conformes. Rejet possible avant candidat. Ne pas dériver l'autorité du texte du contexte. |
| `acceptDelivery(chief/user, AcceptDeliveryArgs, key, version)` | Handoff courant complet, artefacts accessibles/intègres, critères requis, revue approuvée indépendante, IDs de preuves existants/passants et révision exacte. Code : opération d'intégration validée et promotion prouvée ; doc : snapshots SHA sans Git. Tentative exécutante terminale avant acceptation. Débloquer les dépendants dans le même chemin. |
| `finishRun(chief/user, FinishRunArgs, key, version)` | Réutiliser `assertRunCompletable`, vérifier criterion_evidence et delivered_artifact_ids réellement liés aux livraisons acceptées, aucune question/blocage bloquant ouvert. Transition validating→completed + résultat final atomiques. |
| `observation(user, type, payload, correlation)` | Événements provider/tour corrélés aux session/task/attempt réellement observés ; transaction journal seule, sans incrémenter la version métier à chaque fragment de texte. Aucun contournement des transitions par un événement de statut fictif. |

Le Store actuel ne sauvegarde pas encore Review/question/user_response/delegation/blocker/final, et son `updateRunStatus` refuse à juste titre `completed`. Ses `saveVerification`, artefacts, sessions worker, messages, contexte, décisions, événements et opérations restent les briques à réutiliser. Un proof ID contenu dans une revendication d'agent ne remplace pas une preuve réellement enregistrée/contrôlée par le moteur.

NON EXÉCUTÉ : aucun scénario, provider ou L08. Le rapport est une conception courte pour les responsables du scheduler et du transport ; il ne déclare pas leur travail terminé.
