# Registre des prompts et des variables

## Statut de ces fichiers

Ces fichiers sont les **modèles de prompts du futur Avity Crew**. Ils servent de spécification aux développeurs. Les lire pendant la construction ne confère pas un rôle opérationnel et ne doit pas lancer de sessions fournisseurs. Les prompts des agents qui construisent le logiciel sont définis par les consignes de construction du dossier de travail.

## Composition

Construire une invocation avec `TEAM_RULES.md`, un prompt de rôle et le `ContextBundle` courant. `CONTEXT_UPDATE.md` est un message ultérieur. `RECOVERY.md` accompagne une reprise. Les variables sont résolues par le compilateur ; l’orchestrateur ne doit pas inventer leurs valeurs.

| Modèle | Quand l’utiliser |
| --- | --- |
| [TEAM_RULES.md](TEAM_RULES.md) | Toute session gérée par Avity Crew. |
| [ORCHESTRATOR.md](ORCHESTRATOR.md) | Chef actif d’un objectif. |
| [WORKER.md](WORKER.md) | Mission d’implémentation, investigation ou autre production bornée. |
| [REVIEWER.md](REVIEWER.md) | Revue d’artefacts et de versions identifiés. |
| [VALIDATOR.md](VALIDATOR.md) | Vérification de critères et production de preuves. |
| [DOCUMENTATION.md](DOCUMENTATION.md) | Consolidation du fonctionnement accepté et des décisions. |
| [RECOVERY.md](RECOVERY.md) | Nouvelle tentative, reprise native ou remplacement de chef. |
| [CONTEXT_UPDATE.md](CONTEXT_UPDATE.md) | Transmission ciblée d’une information pendant un objectif. |

## Variables communes

| Variable | Origine et règle |
| --- | --- |
| `{{crew_id}}` | Identifiant logique de l’agent attribué par le superviseur ; jamais choisi pour usurper un rôle. |
| `{{run_id}}` | Objectif courant ; requis. |
| `{{task_id}}` | Mission courante ; requis pour les exécutants. Pour le chef, utiliser une identité de contrôle, par exemple `control:<run_id>`, distincte du DAG des tâches livrables. Cette identité ne crée pas de tâche à accepter et est exclue des conditions de clôture de `finish_run`. |
| `{{attempt_id}}` | Tentative active ; requis. |
| `{{generation}}` | Génération d’autorité/fencing attribuée ; requis, contrôlé par le moteur. Elle change lors d’un transfert d’autorité, d’une révocation ou d’une réattribution ; elle reste stable pour les messages et continuations natives de la même attribution. |
| `{{role}}` | Rôle attribué, indépendant du modèle fournisseur. |
| `{{orchestrator_id}}` | Identité du chef actif ou état explicite de passation. |
| `{{project_root}}` | Racine canonique du projet cible ; ne pas confondre avec l’emplacement du pack. |
| `{{workspace_path}}` | Espace réellement attribué à la session. |
| `{{base_revision}}` | SHA ou référence de départ vérifiée. En l’absence de Git autorisée, la valeur du contrat JSON est `null` ; `no_git` peut seulement servir de libellé dans le rendu humain et ne doit jamais remplacer `null` dans les données structurées. |
| `{{objective}}` | Demande retenue pour l’objectif, avec ses contraintes. |
| `{{acceptance_criteria}}` | Critères identifiés et observables ; liste vide interdite pour une mission exécutable. |
| `{{project_context}}` | Résumé validé de la carte du projet et sources utiles. |
| `{{context_bundle}}` | Paquet ciblé, versionné et conforme au contrat. |
| `{{task_spec}}` | Contrat de la mission courante. |
| `{{approved_decisions}}` | Décisions applicables ; tableau vide autorisé et rendu explicitement. |
| `{{available_tools}}` | Capacités réellement exposées à cette session, descriptions et limites. |
| `{{execution_policy}}` | Périmètre et autorisations effectives hérités du moteur et du fournisseur. |
| `{{delivery_contract}}` | Schéma `Handoff` version 1 et procédure de soumission applicable. |

## Variables spécialisées

| Variable | Modèles | Contenu |
| --- | --- | --- |
| `{{run_state}}` | Orchestrateur | Vue durable des tâches, responsables, dépendances, questions et ressources. |
| `{{latest_events}}` | Orchestrateur, reprise | Événements nouveaux ou non traités, identifiés et ordonnés. |
| `{{delivery_mode}}` | Orchestrateur | Résultat final attendu : local, intégré, installé ou déployé selon autorisation. |
| `{{artifacts_to_review}}` | Relecteur | Artefacts et versions exactes ; absence bloquante. |
| `{{verification_plan}}` | Validateur | Critères, risques, commandes et environnements réellement disponibles. |
| `{{accepted_artifacts}}` | Documentation | Artefacts acceptés et preuves ; les propositions sont séparées. |
| `{{documentation_scope}}` | Documentation | Public, fichiers documentaires, sujets et critères. |
| `{{recovery_packet}}` | Reprise | État réconcilié, travaux conservés, effets incertains et prochaine action possible. |
| `{{reconciliation_status}}` | Reprise | Vérifications du superviseur, restrictions et permissions de reprise. |
| `{{message_id}}` | Mise à jour | Identifiant idempotent du message. |
| `{{update_kind}}` | Mise à jour | Décision, livraison, correction, information ou invalidation. |
| `{{update_payload}}` | Mise à jour | Information délimitée, provenance et versions. |
| `{{required_acknowledgement}}` | Mise à jour | Réception seule ou confirmation de l’adaptation attendue. |

## Règles du compilateur

1. Vérifier les variables requises avant envoi. Un nom manquant bloque la préparation avec une erreur exploitable. Aucune syntaxe `{{variable}}` ne doit atteindre le fournisseur.
2. Rendre une valeur absente de façon explicite lorsqu’elle est autorisée. Ne pas fabriquer un SHA, une source, une permission, une fenêtre de contexte ou une commande de test.
3. Sérialiser et délimiter les données structurées. Le contenu d’une donnée ne doit pas fermer une section d’instructions ni devenir un appel d’outil.
4. Exclure les secrets. Les tokens d’authentification du bridge ne figurent pas dans les prompts ; ils sont fournis par le canal d’exécution prévu.
5. Respecter le budget du `ContextBundle`. Conserver les contraintes, critères et décisions ; fournir un index des références exclues et un moyen de les consulter.
6. Vérifier les capacités du connecteur. Un modèle de prompt ne prouve pas la disponibilité d’un outil ou d’une reprise en cours de tour.
7. Conserver la version du prompt, du `TaskSpec` et du `ContextBundle` utilisés. Les erreurs de rendu doivent être testées avant une invocation réelle.

Les valeurs JSON de statut de livraison sont exclusivement `delivered`, `partial` et `blocked`. Elles décrivent la livraison déclarée ; seule une validation du moteur peut faire progresser la tâche vers `accepted`. Les identités `crew_id`, `provider_session_id`, `attempt_id` et `generation` sont distinctes.
