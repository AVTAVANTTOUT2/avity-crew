# Contrats et état durable

## Autorité et version
Les noms ci-dessous et [../schemas/runtime.schema.json](../schemas/runtime.schema.json) définissent le contrat initial v1. Les exemples sont fictifs. L01 produit les types exécutables et valide les équivalences. Le schéma livré sert de point de départ complet, pas de preuve qu'un stockage existe déjà.

L'état du chantier (`coordination/STATE.json`) est distinct de l'état du futur produit.

## Entités
| Entité | Champs et rôle |
|---|---|
| Project | id, chemin canonique, identité Git, configuration, version de carte, règles applicables |
| Run | id, project_id, objectif, contraintes, critères, mode de livraison, statut, chef actif et génération |
| TaskSpec | id, run_id, objectif, critères, périmètre, dépendances, rôle, base, références de contexte, livrables attendus |
| TaskState | état courant, version optimiste, propriétaire, tentative, réservations et motif d'attente |
| Attempt | id, task_id, session_id, génération, démarrage, heartbeat, fin, code de sortie et motifs |
| AgentSession | id interne, fournisseur, modèle, identifiant natif éventuel, version CLI, répertoire, capacités |
| ContextBundle | id, task/run, version, sources, décisions, couches de prompt, budgets et empreinte |
| Message | id, expéditeur, destinataire, portée, séquence, publication, transmission, accusé de prise en compte |
| Decision | id, question, réponse, auteur, statut, sources, décision remplacée, tâches affectées |
| Handoff | résultat, artefacts, vérifications, limites et informations de suite |
| ArtifactRef | type, référence, empreinte ou révision, auteur, provenance et validité |
| Verification | commande structurée, environnement, candidat testé, résultat, dates et logs |
| Review | livraison examinée, mission de revue, avis, défauts, révision et vérifications référencées |
| CrewEvent | séquence, type, corrélation, date, acteur et charge utile typée |
| Operation | effet externe, clé d'idempotence, état, cible, résultat et rapprochement après crash |

## Statuts canoniques
### Tâche
`planned`, `ready`, `running`, `waiting_dependency`, `waiting_user`, `waiting_provider`, `blocked`, `in_review`, `changes_requested`, `validating`, `accepted`, `failed`, `cancelled`.

Les libellés affichés peuvent être en français. Aucun autre état ne doit apparaître sans évolution des contrats.

### Run
`planning`, `running`, `paused`, `waiting_user`, `waiting_provider`, `blocked`, `validating`, `completed`, `failed`, `cancelled`.

### Livraison
`delivered`, `partial`, `blocked`. `delivered` signifie soumission du résultat par son auteur ; cela ne vaut pas acceptation.

### Vérification
`passed`, `failed`, `not_run`, `blocked`. Le mode est distinct : `simulated`, `live` ou `static`. L'absence d'un test réel se rapporte comme `live_unverified` dans le bilan de couverture ; ce n'est pas un résultat `passed`.

## Transitions principales
- Une tâche planifiée devient prête si ses dépendances utiles et ses entrées sont disponibles.
- La délégation réserve atomiquement la tâche et crée une tentative : prête → en cours.
- Une question, dépendance ou limite fournisseur peut créer l'attente correspondante.
- Une soumission valide issue de la tentative active peut passer en revue.
- Une revue peut demander des changements, ce qui crée/reprend une tentative autorisée.
- La validation porte sur un candidat identifié ; son succès permet l'acceptation.
- Une livraison documentaire peut être acceptée sur ses artefacts sans inventer un merge Git.
- L'échec ou l'annulation conserve les preuves et les changements déjà produits.
- `accepted` n'est jamais obtenu par une sortie texte de l'exécutant.
- Une tâche acceptée qui exige une évolution crée une nouvelle tâche liée ; ne pas effacer son historique.

Les transitions exactes sont implémentées et testées dans L02/L07. Les états d'attente portent un motif, une action attendue et les tâches affectées.

Une vérification manuelle sans commande utilise `command: null` et une preuve d'observation. Une vérification automatisée exige une commande structurée non vide. Un rejet de revue peut porter sur la source avant qu'un candidat puisse être créé ; ne jamais inventer une révision testée. L'acceptation finale exige au contraire les preuves adaptées au livrable et à la révision acceptée.

## Invariants
1. Au plus une tentative autorisée à livrer pour une tâche à un instant donné.
2. Chaque commande de mutation porte une clé d'idempotence.
3. Chaque événement a une séquence croissante dans le run et un identifiant stable.
4. Un transfert d'autorité, une révocation ou une réattribution change de génération ; une continuation native normale conserve la génération de la tentative active. Les messages de générations révoquées sont conservés mais ne font pas avancer l'état.
5. Une décision remplacée garde sa provenance et son lien vers la nouvelle.
6. Chaque preuve de code identifie la révision évaluée.
7. Une dépendance circulaire est refusée avec le cycle détecté.
8. La clôture d'un run exige la couverture de tous ses critères requis, ou un état explicitement incomplet.
9. Le compte de concurrence inclut le chef lorsqu'il exécute un tour. La délégation retourne sans attendre l'exécutant ; le chef peut libérer sa place. Une seule place autorise ainsi l'alternance chef/exécutant. Les tâches prêtes attendent une place.
10. Un projet ne peut pas lire ou modifier l'état privé d'un autre via un identifiant fourni librement.

L'identité `control:<run_id>` du chef sert à la corrélation et au contexte. Elle ne crée pas de TaskSpec livrable et reste exclue des conditions d'acceptation du DAG. Dans les templates de prompts, la variable `task_id` peut désigner cette identité de contrôle ; dans les objets TaskSpec et Handoff elle désigne toujours une vraie tâche.

## Persistance
SQLite contient l'état normalisé, les événements et les métadonnées des artefacts. Une transaction regroupe les changements liés. Le superviseur est le writer logique ; les interfaces utilisent son API. Les migrations sont numérotées et testées sur une base précédente et une base interrompue.

Les fichiers volumineux sont stockés hors base avec empreinte ; leur référence n'est publiée qu'après écriture complète. Une opération de nettoyage ne supprime pas une preuve encore référencée. Les journaux sont bornés, archivables et expurgés des secrets.

## Reprise des effets externes
Enregistrer l'intention de lancer, arrêter, créer un worktree ou intégrer avant l'effet. Après crash, l'état `unknown` d'une opération exige observation : PID et identité du processus, référence Git, fichier ou résultat présent. Une commande non idempotente ne se relance pas aveuglément.

Une expiration de heartbeat déclenche un diagnostic. Elle ne libère pas immédiatement une réservation. L'ancien processus doit être arrêté ou son état clarifié avant attribution à une nouvelle génération.

## Provenance du contexte
Chaque source précise type, référence, révision/empreinte si applicable, date d'observation et portée. Les références externes ont un statut de confiance. Les extraits de dépôt sont des données à analyser ; ils ne deviennent pas automatiquement des instructions de contrôle.

Lorsqu'une source change, marquer les bundles affectés comme potentiellement obsolètes, recalculer les mises à jour utiles et enregistrer leur transmission. Un message publié, livré et pris en compte correspond à trois événements distincts.

