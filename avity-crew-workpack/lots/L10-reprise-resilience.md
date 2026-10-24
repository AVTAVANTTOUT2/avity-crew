# L10 — Reprise, limites fournisseur et remplacement du chef

**Dépendances :** [L09](L09-cli-tui.md).  
**Résultat :** l’équipe conserve son travail face aux interruptions et reprend sans double exécution incontrôlée.  
**Propriétaire conseillé :** agent fiabilité / runtime.

**Références :** [consignes de construction](../agent.md), [DATA_MODEL](../docs/DATA_MODEL.md), [ORCHESTRATION](../docs/ORCHESTRATION.md), [ACCEPTANCE](../docs/ACCEPTANCE.md).

## Objectif

Prouver que le contexte et l’état persistent au-delà d’une conversation ou d’un processus. La robustesse doit être démontrée sur des incidents contrôlés, avec des résultats observables et une conservation des contributions.

## Travail à réaliser

1. À la reconnexion, reconstruire l’état depuis le stockage et vérifier les processus encore présents. Distinguer un service perdu, une vue terminal fermée, une session interrompue et une machine arrêtée.
2. Réconcilier les opérations dont l’issue est inconnue avant de les répéter. Les identifiants d’opération et les références Git servent à éviter les doubles livraisons et doubles intégrations.
3. Mettre en place l’attente et les reprises contrôlées des erreurs transitoires. Pour les limites fournisseur et erreurs d’authentification, conserver le travail et rendre la cause visible. Un changement de fournisseur doit respecter le choix et le budget du run.
4. Remplacer un exécutant : arrêter ou révoquer l’ancien propriétaire, conserver son espace et ses changements, créer une nouvelle tentative puis fournir le dossier de reprise. Une réponse tardive de l’ancien ne peut pas être acceptée.
5. Remplacer le chef : suspendre son autorité, produire le dossier global, attribuer le rôle au nouveau chef et vérifier qu’il reprend le graphe existant. Les tâches indépendantes déjà confiées peuvent continuer.
6. Gérer la saturation de contexte par le mécanisme disponible du fournisseur ou par une nouvelle session avec dossier de reprise. Ne pas promettre de transférer la mémoire interne d’un fournisseur à l’autre.
7. Encadrer les boucles qui n’avancent plus : erreurs répétées, reprises sans changement, agents qui se renvoient indéfiniment la même question. Signaler la cause et demander une stratégie différente lorsque nécessaire.
8. Définir conservation et récupération des données, rotation des journaux et arrêt contrôlé. Un nettoyage ne peut pas effacer une livraison non acceptée sans traitement explicite.

## Scénarios d’incident

Créer des points de coupure déterministes : après affectation, après début de modification, après réception de livraison, pendant préparation d’intégration et juste avant confirmation finale. Injecter également un événement dupliqué, une réponse tardive et une fausse absence de heartbeat.

Les tests sur le runtime déterministe prouvent les invariants. Un parcours live borné doit compléter ces preuves pour la reprise réelle des sessions natives supportées.

## Périmètre et coordination

Ce lot corrige les mécanismes de fiabilité existants ; il ne reconçoit pas les contrats sans concertation. Toute migration nécessaire est documentée. Il ne transforme pas la V1 en exécution distribuée entre plusieurs hôtes : la séparation entre terminal client et service local reste explicite.

## Critères d’acceptation

- **AC-L10-01 — Reconnexion :** fermer puis rouvrir la vue retrouve l’objectif, les tâches et les processus attendus.
- **AC-L10-02 — Coupure :** une interruption contrôlée conserve les changements et l’état de l’opération.
- **AC-L10-03 — Déduplication :** livraison et intégration ne sont appliquées qu’une fois malgré un rejeu.
- **AC-L10-04 — Remplacement :** une ancienne tentative ne peut pas livrer après réattribution.
- **AC-L10-05 — Nouveau chef :** Claude peut passer la conduite à Codex ou inversement avec décisions et dépendances conservées.
- **AC-L10-06 — Limite fournisseur :** la mission attend ou est reprise selon la politique choisie, sans succès inventé.
- **AC-L10-07 — Contexte :** une nouvelle session poursuit une mission à partir d’un dossier inspectable.

## Passation

Livrer les traces avant/après, procédures de récupération et problèmes non résolus. Identifier les scénarios simulés et live, les versions testées et les capacités qui dépendent encore du fournisseur.

