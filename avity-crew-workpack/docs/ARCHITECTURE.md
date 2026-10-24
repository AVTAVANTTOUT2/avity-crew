# Architecture de réalisation

## 1. Principe
Le superviseur logiciel conserve l'état et applique les transitions. L'IA orchestratrice choisit les actions et raisonne sur les objectifs. Le contenu d'une conversation n'est jamais l'unique stockage d'une décision ou d'une livraison.

Un seul superviseur est propriétaire d'un projet sur un hôte. Plusieurs interfaces peuvent le consulter ; une seule autorité orchestratrice est active pour un run. Les travaux de l'utilisateur ou d'autres outils externes sont détectés et réconciliés, pas écrasés.

## 2. Socle proposé
Si L00 ne découvre pas un socle compatible, adopter :
- TypeScript strict pour les contrats, le superviseur et les adaptateurs.
- Node.js 24 LTS comme version de référence initiale, versions exactes verrouillées.
- npm workspaces pour les modules et un lockfile unique.
- SQLite pour l'état transactionnel ; un driver maintenu dont l'installation est vérifiée sur les plateformes cibles. L01 choisit et documente le driver, notamment ses dépendances natives.
- Un service local unique, un canal de commande local authentifié et un flux d'événements avec curseur.
- Une CLI commune et une TUI ; une bibliothèque de rendu maintenue peut être choisie en L01.
- Un bridge MCP stdio vers le même service pour les agents, avec une CLI interne de repli testée.

Le bridge ajoute les outils de coordination aux CLI fournisseurs. Il ne remplace pas leur boucle d'agent. Les tests de code arbitraire ne reçoivent pas les capacités administratives du superviseur.

## 3. Modules et frontières
| Module proposé | Responsabilité | Dépendances autorisées |
|---|---|---|
| `packages/contracts` | Types, JSON Schema, erreurs, événements et version du protocole | Bibliothèque de validation uniquement |
| `packages/core` | État, transitions, contraintes et planification déterministe | contracts + ports de stockage |
| `packages/storage` | SQLite, migrations, transactions, artefacts et snapshots | contracts |
| `packages/context` | Carte du projet, provenance, sélection et compilation des prompts | contracts + ports de lecture |
| `packages/providers` | Adaptateurs Claude/Codex et faux provider de test | contracts + ports de processus |
| `packages/workspace` | Worktrees, commits, intégration, ports et environnements | contracts + exécuteur contrôlé |
| `packages/supervisor` | Processus, outils agents, IPC, abonnements, reprise | Modules précédents |
| `apps/cli` | Commandes, conversation et TUI | API du superviseur |
| `tests/fixtures` | Projets de recette isolés | Aucun secret utilisateur |

Ces chemins sont une proposition initiale. L01 fixe les chemins effectifs et l'API publique pour que les agents parallèles ne les réinventent pas.

## 4. Boucle minimale verticale
1. CLI résout le projet et rejoint/crée le service local.
2. Le service enregistre le Run et prépare un ContextBundle pour le chef.
3. L'adaptateur lance la CLI du chef avec ses capacités minimales et le bridge.
4. Le chef appelle les outils de projet et crée les TaskSpec.
5. Le superviseur valide chaque appel, persiste l'intention et attribue une tentative aux tâches prêtes.
6. Contexte et workspace sont préparés ; une session exécutante démarre.
7. Les événements natifs sont normalisés ; notes et livraisons arrivent au service.
8. Le chef reçoit les événements utiles au prochain point de communication supporté.
9. Revue, intégration et validation sont exécutées selon les critères.
10. `finish_run` contrôle les preuves et produit le rapport.

Cette tranche doit fonctionner avec un vrai chef et deux exécutants à la fin de L08, avant de compléter l'interface avancée.

## 5. Contrat d'adaptateur
Chaque adaptateur expose conceptuellement :
- `probe()` : binaire, version, authentification résumée sans secret, modèles et capacités vérifiées.
- `start(request)` : répertoire, mission, contexte, rôle, modèle, permissions, bridge et corrélation.
- `resume(request)` : reprise ciblée si disponible ; jamais « dernière session » ambiguë.
- `send(update)` : livraison immédiate si supportée ou mise en attente documentée.
- `interrupt()` et `stop()` : arrêt contrôlé du processus et de ses enfants.
- Un flux d'événements et un résultat terminal typés.

Les capacités annoncent `native_resume`, `structured_events`, `mid_turn_input`, `permission_requests`, `mcp_tools`, `usage_reporting`, chacune avec `supported|unsupported|unverified`. Une capacité inconnue n'est pas activée par supposition.

Une session, une tâche et un processus ne sont pas le même objet. Enregistrer les identifiants distincts. Le processus lancé est propriétaire de sa conversation ; ne jamais envoyer simultanément depuis deux contrôleurs.

## 6. Outils accessibles au chef
Les noms sont le contrat initial du futur produit :
- `inspect_project` : obtenir carte et références utiles.
- `create_task` : créer une mission avec critères et dépendances.
- `delegate_task` : demander l'affectation d'une tâche prête.
- `get_status` : lire un état borné avec curseur d'événements.
- `send_message` : transmettre une information ciblée.
- `collect_delivery` : consulter une livraison et ses preuves.
- `record_decision` : enregistrer/adopter un choix technique autorisé ou une réponse utilisateur référencée ; l'autorité et l'acteur sont vérifiés côté service.
- `submit_review` : déposer une revue avec résultat `approved`, `changes_requested` ou `blocked`. Un refus peut précéder la création d'un candidat intégré.
- `request_user_input` : déposer une question liée à une décision.
- `propose_integration` : préparer un candidat de code à partir d'artefacts identifiés et demander les vérifications adaptées.
- `accept_delivery` : demander l'acceptation d'une livraison ; le moteur vérifie revue, preuves, révision et règles d'intégration. Ce chemin couvre aussi un livrable documentaire sans Git.
- `finish_run` : proposer la clôture, soumise aux vérifications du moteur.

Les exécutants reçoivent `read_context`, `publish_note`, `report_blocker` et `submit_handoff`, selon leur rôle. Le rôle relecteur reçoit `submit_review` pour la livraison qui lui a été attribuée. Ils ne peuvent ni accepter leur propre livraison, ni modifier les droits, ni clore le run.

Un avis `approved` du relecteur ne clôt pas à lui seul une tâche. `accept_delivery` applique les règles finales : pour le code, le candidat combiné et ses tests ; pour des documents, les empreintes et vérifications adaptées. Un avis `changes_requested` fait passer la tâche concernée dans cet état et notifie le chef pour une correction. Une décision basée sur l'utilisateur exige une référence à une réponse réellement reçue ; le chef ne peut pas fabriquer cette approbation.

Chaque mutation possède une clé d'idempotence, un identifiant de run, un contrôle de version et l'identité de tentative établie par le canal. L'identité déclarée librement dans un JSON ne confère aucun droit.

`delegate_task` est non bloquant : enregistrer la demande et retourner son état en file. Le chef peut terminer son tour et libérer sa place. Avec `max_active_agents = 1`, l'équipe alterne chef, exécutant, puis chef ; aucune attente active ne doit monopoliser l'unique place. Une session native persistante mais inactive ne consomme pas une place de tour actif.

Le chef utilise l'identité de contrôle `control:<run_id>`, hors du graphe des tâches livrables. `finish_run` ne s'attend donc jamais à l'acceptation d'une prétendue tâche du chef. Les `ContextBundle` distinguent `subject_kind: control` et `subject_kind: task`.

## 7. Transport et état
Une socket locale ou un endpoint de boucle locale protégé sert à la CLI et au bridge. L01 fixe un transport unique de référence et teste les chemins longs/espaces. Aucun écouteur public par défaut. Les droits du canal et ses capacités sont bornés au projet et au rôle.

Les événements ont un numéro monotone par run. L'abonnement demande `after_seq` et peut relire les événements manqués. La reprise est « au moins une fois » avec déduplication, pas une promesse d'exécution externe exactement une fois.

Le service persiste commande, transition et événement dans une transaction. Les effets externes sont suivis par une opération distincte : intention, démarrage, observation, résultat. Après un crash entre effet et confirmation, inspecter l'effet avant de le reproduire.

## 8. Git et ressources
Une tâche de modification reçoit un workspace préparé depuis une base identifiée. Préserver le dossier principal et les changements utilisateurs. Les opérations sur les références communes et l'intégration passent par une file unique.

Un candidat intégré est une nouvelle révision immuable. Les tests portent sur ce candidat. L'avancement de la branche cible utilise la base attendue ; si elle a changé, recalculer l'intégration et refaire les vérifications affectées.

Attribuer des ports, chemins temporaires et bases de test distincts. Des réservations expirables sont des mécanismes de coordination, pas une isolation de sécurité. Le travail hors du périmètre déclaré est détecté à la soumission et nécessite une justification et une revue.

## 9. Configuration et dossiers
- Configuration projet versionnable : préférences, commandes de vérification et contraintes, sans secrets.
- État opérationnel : répertoire de données utilisateur, namespace par projet canonique.
- Artefacts et journaux : fichiers sous le même namespace, références relatives et empreintes.
- Secrets/capacités du service : stockage privé local, jamais incorporés au prompt ou aux rapports.
- Workspaces : répertoire dédié configurable, avec lien vers le projet et nettoyage explicite.

L'identité projet est obtenue à partir des chemins réels et de l'identité du dépôt, en tenant compte des worktrees. Deux chemins symboliques vers le même dépôt ne doivent pas démarrer deux superviseurs concurrents. Deux dépôts distincts ne doivent pas partager leur état.

## 10. Reprise et surveillance
Le service gère l'arbre de processus, les pipes, l'encodage UTF-8 fragmenté, la taille des événements, les limites de logs et la pression des sorties. Un silence ne signifie pas un crash. Une fin de processus ne signifie pas une tâche acceptée.

Lors d'un redémarrage, réconcilier les tentatives : processus vivant, sortie observée, workspace, opération Git et derniers événements. Une ancienne génération ne peut plus soumettre après remplacement. Les tentatives inconnues restent bloquées jusqu'à clarification de leur état.

Un changement de chef invalide l'ancienne capacité de pilotage, prend un checkpoint et prépare le nouveau contexte. Les exécutants indépendants continuent si leurs missions restent valides.

## 11. Permission et observation
Respecter les restrictions natives de chaque CLI. Convertir les demandes ou refus en état visible. Si le mode lancé ne sait pas dialoguer sur une permission, mettre la tâche en attente et proposer le chemin supporté ; ne simuler aucune acceptation en écrivant « yes » dans un terminal.

Les commandes de vérification utilisent des arguments structurés et un répertoire validé. Une commande nécessitant un shell doit être explicitement identifiée comme telle. Aucun contenu de prompt ou chemin externe ne doit devenir une interpolation de shell.

Documenter le niveau d'isolation réellement obtenu. Le produit est un assistant local personnel, pas une plateforme multi-utilisateurs hostile.

## 12. Évolution
Les futures interfaces web ou fournisseurs utilisent les mêmes contrats. Ne dupliquer ni l'état ni le moteur. Les changements de schéma ont une migration, une stratégie de reprise et des fixtures de compatibilité. Toute nouvelle capacité est testée avant d'être annoncée.

