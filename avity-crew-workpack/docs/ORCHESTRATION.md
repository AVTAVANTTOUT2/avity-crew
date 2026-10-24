# Boucle de travail et protocole de délégation

## 1. Responsabilités

Ce document spécifie le comportement à construire dans Avity Crew. L’orchestrateur IA comprend la demande, choisit le découpage, attribue les missions et arbitre les choix. Le superviseur logiciel conserve l’état, vérifie les transitions, lance les sessions et organise les livraisons. Le moteur demeure l’unique propriétaire de l’état d’autorité.

Un objectif global est un `run`. Il possède une demande, des contraintes, des critères de fin et un mode de livraison. Une mission est un `TaskSpec`. Une session fournisseur exécute une tentative de mission ; elle n’est ni l’objectif ni la tâche elle-même. Cette distinction permet la reprise et la réattribution.

Le modèle du chef est configurable. Une seule session possède à un instant donné l’autorité active de planification pour un même objectif. Son identité de contrôle, par exemple `control:<run_id>`, est distincte du DAG des tâches livrables. Elle peut remplir le champ de corrélation `task_id` de ses prompts, mais ne crée pas une tâche à accepter et n’entre pas dans les conditions de clôture de `finish_run`. Les rôles d’exécution sont attribués selon les besoins ; sept places configurées ne constituent pas une obligation de maintenir sept agents occupés.

## 2. Début d’un objectif

Le chef commence par lire la demande et reconnaître le projet cible. Il réutilise la mémoire valide et fait examiner les zones pertinentes. Pour un dépôt existant, il relève l’état de départ et les modifications déjà présentes ; aucune suppression ou réinitialisation de travail existant n’est implicite.

Il formule des critères de réussite observables. Les ambiguïtés qui changent le produit sont recherchées dans les instructions et le code, puis soumises à l’utilisateur si elles restent ouvertes. Les choix courants couverts par les conventions du projet peuvent être résolus et documentés directement.

Une question suspend les seules missions dont la réponse conditionne le travail. Les tâches indépendantes restent exécutables. Une hypothèse ne devient pas une règle métier définitive parce qu’elle a permis de commencer un prototype.

## 3. Préparer des missions exécutables

Chaque `TaskSpec` contient l’objectif concret, les critères d’acceptation, les dépendances, le périmètre, les ressources requises, les livrables attendus et le contexte à compiler. Le modèle est disponible dans [`../templates/TASK.md`](../templates/TASK.md).

Le chef établit un graphe de dépendances sans cycle. Une mission est prête lorsque ses prérequis sont satisfaits et que les ressources nécessaires sont disponibles. Deux missions peuvent partager un contrat d’interface versionné ; la livraison de code de l’une n’est alors pas forcément nécessaire pour commencer l’autre.

Une tâche transversale doit expliquer son utilité. Un refactoring traite une difficulté identifiée. Une modification de CI comble un besoin d’exécution ou de vérification constaté. Les droits de création, modification ou suppression d’un objet métier restent ceux de la demande retenue.

## 4. Actions de coordination et rôles

Les noms ci-dessous constituent le contrat fonctionnel à normaliser en L01. Les transports peuvent être MCP ou CLI vers le service local ; les règles de validation restent communes.

| Action | Rôle habilité | Entrée essentielle | Résultat attendu |
| --- | --- | --- | --- |
| `inspect_project` | Selon périmètre attribué | Projet, question ou périmètre | Observations référencées, commandes et zones utiles. |
| `create_task` | Chef | `TaskSpec` et version de l’objectif | Tâche persistée, ou erreurs de validation. |
| `delegate_task` | Chef | Tâche prête, fournisseur, capacités et ressources | Demande persistée et tâche en file ; tentative, session et espace attribués lorsqu’une place est disponible. |
| `get_status` | Selon périmètre attribué | Objectif ou liste de tâches | État observé, activité, dépendances et blocages. |
| `send_message` | Selon destinataires autorisés | Destinataires, contenu, source et criticité | Identifiant du message et état de transmission. |
| `submit_handoff` | Exécutant de la tentative active | Livraison et références de preuve | `Handoff` enregistré et contrôlé structurellement, sans acceptation de la tâche. |
| `collect_delivery` | Chef ou relecteur habilité | Tentative et référence de livraison | Lecture du `Handoff` conservé et de ses artefacts ; aucune acceptation implicite. |
| `request_user_input` | Chef | Décision manquante et conséquences | Réponse corrélée ou attente explicite. |
| `record_decision` | Chef | Choix, portée, références et `user_response_id` si réponse utilisateur | Décision enregistrée ; auteur et autorité déterminés par le serveur à partir des éléments vérifiés. |
| `submit_review` | Relecteur habilité | Livraison examinée, observations et verdict | Revue `approved`, `changes_requested` ou `blocked`, y compris avant création d’un candidat intégré. |
| `propose_integration` | Chef | Livraisons et versions examinées | Candidat de code et vérifications associées, avec événements de résultat. |
| `accept_delivery` | Chef | Livraison, revue et preuves applicables | Tâche acceptée par le moteur si ses conditions sont satisfaites, y compris pour des documents sans Git. |
| `finish_run` | Chef | Critères globaux et preuves finales | Clôture vérifiée ou liste des critères encore ouverts. |

Une sortie de modèle proposant une action doit passer par les mêmes validations qu’un appel d’outil. Les identités et permissions viennent du canal authentifié et de la session attribuée, jamais d’un simple champ libre choisi par l’agent. Les outils ne donnent pas aux exécutants la possibilité de clôturer eux-mêmes l’objectif global.

`record_decision` conserve les décisions explicites et leur provenance. Lorsqu’un choix provient de l’utilisateur, `user_response_id` doit désigner une réponse réellement reçue pour la question et l’objectif concernés. Les champs d’auteur et d’autorité sont calculés côté serveur ; l’agent ne peut pas s’attribuer une approbation utilisateur par déclaration. Les choix ordinaires du chef sont identifiés comme tels.

`delegate_task` est non bloquant : sa réponse confirme l’enregistrement de la demande, pas la fin du travail. Après ses décisions et délégations, le chef termine son tour et libère sa place. Le superviseur le réveille à réception d’un événement utile. Avec `max_active_agents=1`, les tours du chef et ceux des exécutants alternent ; aucune délégation ne doit attendre une place tout en immobilisant celle du chef. Éviter les boucles de consultation active qui empêcheraient un exécutant de démarrer.

## 5. Exécution et événements

Le superviseur démarre une session avec son `ContextBundle`, ses droits et son environnement. Il conserve l’identifiant fournisseur, l’identifiant de tentative et un jeton de génération empêchant une ancienne tentative d’agir après réattribution. La génération change lors d’un transfert d’autorité, d’une révocation ou d’une réattribution. Un nouveau message ou une continuation native dans la même attribution ne change pas à lui seul cette génération.

Les événements sont normalisés en `CrewEvent` : début, activité, message, besoin de décision, livraison, erreur, interruption et fin. Ils portent un identifiant, un ordre local et les corrélations objectif/tâche/tentative. Les événements inconnus du fournisseur sont conservés sous une forme diagnostique compatible, sans être interprétés comme une réussite.

Le chef travaille à partir des événements et des états utiles. Le moteur ne doit pas lui renvoyer tous les historiques à chaque modification. Le silence d’une session ne prouve ni sa mort ni son succès : le superviseur examine le processus, ses opérations et les délais adaptés.

La concurrence respecte les places disponibles, les dépendances, les ressources et les limites des fournisseurs. Une limitation temporaire produit une attente identifiable. Toute bascule vers un autre moteur respecte les choix autorisés pour l’objectif.

## 6. Recevoir, relire et intégrer

Une livraison `Handoff` contient un état déclaré, les changements, les `ArtifactRef`, les vérifications, les informations de passation et les éléments restant ouverts. Le moteur rejette une livraison structurellement incomplète. Une livraison complète reste une déclaration à examiner, pas une preuve automatique de réussite.

La revue porte sur une version identifiée, la demande d’origine et les décisions applicables. Le relecteur reçoit aussi les limites connues. Il décrit les défauts avec leur impact et des éléments vérifiables, puis utilise `submit_review` avec `approved`, `changes_requested` ou `blocked`. Les corrections peuvent être demandées avant l’existence d’un candidat intégré, notamment si une fusion est impossible. Aucun candidat ni résultat de test ne doit être inventé pour rendre cette demande recevable. Les préférences de style non liées à un critère ne doivent pas provoquer une réécriture générale.

À la demande `propose_integration`, le superviseur prépare un candidat de code dans un espace contrôlé et organise ses vérifications. Une seule opération d’intégration fait progresser la référence commune à la fois. Les tests nécessaires portent sur le résultat combiné. Les preuves enregistrent la révision exacte du candidat, les commandes, l’environnement pertinent et les résultats.

Si la référence cible a changé pendant la validation, le moteur prépare le nouveau candidat et renouvelle les vérifications affectées. Une commande Git réussie n’établit pas à elle seule la cohérence métier. Les branches et changements utiles restent disponibles en cas de conflit.

Le chef demande ensuite `accept_delivery`. Le moteur vérifie la revue, les critères et les preuves applicables avant de faire passer la tâche à `accepted`. Une livraison documentaire sans Git suit cette même clôture avec des empreintes d’artefacts et des validations documentaires ; elle n’exige pas de candidat Git fictif. Ni `submit_handoff`, ni `collect_delivery`, ni un avis `approved` ne clôturent automatiquement la tâche.

## 7. Adapter la suite

Après chaque livraison, le chef choisit entre accepter le résultat, demander une correction, créer un complément, débloquer une dépendance ou demander une décision. Une correction comporte une cause, un résultat attendu et les références nécessaires. Les tentatives précédentes sont transmises afin d’éviter leur répétition aveugle.

Une nouvelle information peut invalider une mission en cours. Le moteur la signale et demande une réconciliation avant acceptation de la livraison concernée. Les changements de périmètre et de critères restent explicites ; le chef ne les abaisse pas pour pouvoir annoncer une réussite.

Des échecs répétés entraînent une réévaluation de stratégie ou une remontée motivée. Le système conserve les progrès déjà acquis. Les limites de temps ou de ressources sont configurables et produisent un résultat partiel clairement identifié si elles empêchent la fin.

## 8. États, reprise et annulation

Les états canoniques de tâche sont `planned`, `ready`, `running`, `waiting_dependency`, `waiting_user`, `waiting_provider`, `blocked`, `in_review`, `changes_requested`, `validating`, `accepted`, `failed` et `cancelled`. Les transitions sont définies dans le [modèle de données](DATA_MODEL.md) et figées en L01. Une interruption est enregistrée comme un événement de tentative ; la tâche attend la réconciliation dans l’état approprié. Une mission acceptée conserve ses preuves ; une mission annulée conserve ses changements utiles et la raison.

Après redémarrage, le superviseur réconcilie le journal, les sessions, les processus et Git avant de relancer. Une opération externe à l’issue inconnue est examinée ; elle n’est pas répétée automatiquement. Les commandes avec effets utilisent des identifiants d’idempotence lorsque cela s’applique. L’expiration d’un bail ne suffit pas à prouver que l’ancien processus s’est arrêté.

Un changement de chef révoque l’autorité de l’ancien, prépare un dossier de reprise et active le nouveau. Les exécutants peuvent poursuivre leurs missions indépendantes. Une nouvelle tentative ne peut soumettre ou intégrer à la place de l’ancienne sans attribution explicite.

## 9. Documentation et communication utilisateur

Le journal d’événements expose les faits du déroulement. La documentation durable explique le produit livré, les décisions et les procédures utiles. Les deux se complètent. Les agents documentent leurs livraisons ; le documentaliste consolide les informations acceptées.

Les messages d’avancement expliquent ce qui est obtenu, ce qui attend une dépendance et la prochaine étape. Ils évitent les pourcentages inventés. Les demandes utilisateur reçues pendant le travail sont enregistrées, évaluées pour leur impact et propagées aux tâches concernées.

## 10. Clôture et preuve de fonctionnement

`finish_run` vérifie les critères globaux, les tâches nécessaires, la fraîcheur des preuves et le mode de livraison convenu. Le rapport distingue code produit, version intégrée, installation vérifiée et déploiement éventuel. Un déploiement ne peut être annoncé sans preuve et autorisation correspondant à cet objectif.

La recette doit démontrer une feature réelle avec chef et exécutants de fournisseurs différents, une correction issue de revue, une reprise après interruption et une validation sur les changements réunis. Le scénario de planning chauffeur est une fixture de démonstration à construire selon ses règles explicites ; aucune fonctionnalité d’Avity Transport n’est supposée déjà présente.

Les recettes simulées sont adaptées à la CI ordinaire. Les recettes avec Claude/Codex réels constituent des preuves distinctes. Si les accès nécessaires ne sont pas disponibles, les vérifications concernées restent non exécutées et la validation globale ne doit pas être déclarée complète.
