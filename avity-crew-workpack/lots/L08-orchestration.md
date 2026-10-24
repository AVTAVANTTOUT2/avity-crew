# L08 — Orchestration autonome de bout en bout

**Dépendances :** [L07](L07-superviseur-outils.md).  
**Résultat :** un chef Claude ou Codex transforme un objectif en missions, exploite les livraisons et poursuit jusqu’aux critères de fin.  
**Propriétaire conseillé :** agent orchestration / produit.

**Références :** [consignes de construction](../agent.md), [CONTEXT](../docs/CONTEXT.md), [ORCHESTRATION](../docs/ORCHESTRATION.md), [ACCEPTANCE](../docs/ACCEPTANCE.md).

## Objectif

Implémenter la boucle essentielle d’Avity Crew : comprendre, préparer les missions, déléguer, recevoir, vérifier, adapter et livrer. Le chef raisonne et choisit ; le superviseur valide les actions et conserve l’état. Une simple liste de tâches générée ne satisfait pas ce lot.

## Travail à réaliser

1. Recevoir une demande en langage naturel avec ses contraintes et son mode de livraison. Produire un dossier d’objectif conservant la demande originale, les décisions et les critères de réussite.
2. Déclencher l’exploration pertinente du projet. Utiliser les informations existantes avant de demander des précisions. Les questions restantes doivent expliquer l’arbitrage nécessaire ; les missions indépendantes peuvent continuer.
3. Transformer l’objectif en graphe de tâches exécutables. Chaque mission possède son contexte, périmètre, dépendances, critères et forme de livraison. Détecter cycles, dépendances introuvables et missions trop vagues.
4. Fixer les contrats communs avant de distribuer des travaux dépendant des mêmes interfaces. Réserver les ressources nécessaires et choisir le fournisseur et le modèle parmi les capacités disponibles.
5. Lancer les missions prêtes dans la limite configurée. `delegate_task` enregistre la délégation et retourne sans attendre la fin de l’exécutant. Le budget compte les tours effectivement actifs ; avec `max_active_agents = 1`, le chef libère sa place pour permettre l’alternance chef → exécutant → chef. Les rôles ne sont pas des places à occuper artificiellement : CI, documentation et refactoring interviennent avec des résultats attendus précis.
6. Consommer les événements de livraison, blocage, question et échec. Enregistrer les décisions par `record_decision` avec leurs sources et un acteur contrôlé côté moteur. Demander une correction, créer une mission complémentaire ou modifier l’organisation avec une justification enregistrée.
7. Faire relire et vérifier les changements selon leur risque et les critères convenus. Le relecteur soumet `submit_review` avec `approved`, `changes_requested` ou `blocked` ; il peut signaler un refus avant qu’un candidat existe. `propose_integration` prépare le candidat de code et ses contrôles, puis le chef demande `accept_delivery`. Le moteur exige la revue indépendante et les preuves applicables, y compris pour accepter un document sans Git. Une livraison sans éléments requis reste incomplète. La validation globale porte sur les changements réunis.
8. Préparer les mises à jour utilisateur : réalisations, activité, blocages, décisions et prochaine étape. Éviter les pourcentages inventés ; exprimer la progression par les critères et livraisons constatés.
9. Définir la clôture : le chef compare les preuves à l’objectif, signale les critères manquants et termine seulement quand les conditions sont satisfaites.

## Prompts et continuations

Compiler un contexte du chef contenant objectif, graphe, décisions et résumés des livraisons, avec ouverture possible des preuves détaillées. Maintenir les consignes stables séparées des événements. Une même session peut poursuivre une mission cohérente ; une réattribution ou une perte de contexte utilise un dossier de reprise.

Les boucles correctives sont traçables. Si des tentatives répétées reproduisent l’échec, le chef doit changer de stratégie ou signaler le blocage ; il ne peut pas retirer un critère pour obtenir artificiellement un succès.

## Vérifications

Utiliser un projet jetable offrant une petite fonctionnalité divisible. Le premier jalon réel doit montrer un chef et deux exécutants, dont Claude et Codex, travaillant sur des parties indépendantes puis réunies. Injecter un défaut de livraison ou une contradiction de contrat et observer la création d’une correction ciblée. Exécuter aussi un scénario avec `max_active_agents = 1` pour vérifier que la délégation retourne et que le travail se termine sans interblocage ni dépassement de concurrence. Compléter par un objectif documentaire dans un dossier sans Git : le document et son empreinte sont livrés, relus indépendamment, puis acceptés sans merge ni initialisation Git artificiels.

## Critères d’acceptation

- **AC-L08-01 — Mission exploitable :** chaque exécutant reçoit un brief complet lié à l’objectif.
- **AC-L08-02 — Parallélisme réel :** deux exécutants mixtes avancent simultanément lorsque leurs dépendances le permettent.
- **AC-L08-03 — Boucle corrective :** un retour de revue produit une correction, une nouvelle vérification et une décision.
- **AC-L08-04 — Chef interchangeable :** le même objectif peut démarrer avec Claude ou Codex sans changer le modèle de données.
- **AC-L08-05 — Fin justifiée :** les critères restants empêchent la clôture et les preuves terminées sont référencées.
- **AC-L08-06 — Une seule place :** avec `max_active_agents = 1`, le chef délègue sans appel bloquant, libère sa place puis reprend après la livraison ; aucun instant n’excède un tour actif.
- **AC-L08-07 — Document sans Git :** une livraison documentaire identifiée par son empreinte atteint l’acceptation après revue indépendante et preuves, sans candidat Git fictif.

## Passation

Livrer les templates du chef, règles de progression, traces des décisions et preuves du scénario. Si le jalon réel reste impossible faute d’accès, noter `live_unverified` ; une démonstration avec fournisseurs simulés ne clôt pas la recette du produit.

