# L02 — État persistant, transactions et journal

**Dépendances :** [L01](L01-socle-contrats.md).  
**Résultat :** une source d’autorité durable pour les objectifs, missions, sessions, messages et preuves.  
**Propriétaire conseillé :** agent domaine / stockage.

**Références :** [consignes de construction](../agent.md), [DATA_MODEL](../docs/DATA_MODEL.md), [ORCHESTRATION](../docs/ORCHESTRATION.md).

## Objectif

Conserver le travail de l’équipe indépendamment des conversations et de l’affichage. SQLite devient le stockage transactionnel d’un service local unique ; les agents utilisent les opérations du service au lieu d’écrire chacun dans la base ou dans un grand fichier partagé.

## Travail à réaliser

1. Implémenter le schéma et les migrations de la base. Enregistrer sa version et vérifier les migrations depuis une version antérieure. Les répertoires de données, caches et journaux sont explicitement séparés du code et des documents de projet.
2. Implémenter les opérations de domaine sur projets, objectifs, tâches, tentatives, décisions, messages, sessions et livraisons. Une mutation et son événement associé doivent être enregistrés dans une même transaction ou par un mécanisme garantissant leur réconciliation.
3. Ajouter des identifiants d’opération pour dédupliquer les requêtes répétées. Un second envoi d’une même livraison ne crée ni double tâche ni seconde intégration.
4. Protéger l’affectation d’une tâche par une génération ou un jeton de tentative. Une ancienne session ne peut plus soumettre une livraison après réattribution.
5. Conserver les dates, révisions, auteurs et provenances. Une proposition, une décision adoptée et un résultat observé gardent des statuts distincts.
6. Donner aux messages un état minimal enregistré, livré, pris en compte ou échec. L’absence de prise en compte ne doit pas être affichée comme une lecture certaine.
7. Produire des vues de lecture et un journal exportable. Les sorties Markdown sont des projections lisibles ; leur édition libre ne doit pas contourner les transitions du service.
8. Prévoir sauvegarde cohérente, réouverture après arrêt brutal, expiration contrôlée des baux et détection des opérations dont l’issue reste inconnue.

## Invariants obligatoires

Une tâche n’a qu’une tentative active propriétaire de sa livraison. Une dépendance non satisfaite empêche sa mise en exécution. Les preuves se rapportent à une tâche, une tentative et une version identifiables. Un changement de chef ne détruit aucun travail. Les migrations sont explicites et ne remplacent pas silencieusement une base incompatible.

La fin de bail signale un état à examiner. Elle n’autorise pas à démarrer un second processus sans vérifier l’ancien. La capacité à clôturer ou réattribuer est contrôlée par le service et non par l’identité textuelle envoyée dans le prompt.

## Périmètre et parallélisation

Ce lot possède le domaine persistant et son accès. Les adaptateurs peuvent avancer en parallèle sur les contrats L01. Les tests de stockage utilisent des bases temporaires isolées. Le service commun de L07 consommera ces opérations ; il ne doit pas réimplémenter les règles transactionnelles.

## Vérifications pertinentes

Tester deux réclamations concurrentes sur une tâche, le rejeu d’une requête, un ancien jeton qui tente une livraison, une coupure entre mutation et émission externe, une migration et la réouverture d’une base après interruption. Vérifier également qu’un journal volumineux peut être lu par pages sans charger tout l’historique.

## Critères d’acceptation

- **AC-L02-01 — Concurrence :** une seule réclamation concurrente obtient la tâche.
- **AC-L02-02 — Rejeu :** répéter une opération avec le même identifiant ne double pas ses effets.
- **AC-L02-03 — Tentative périmée :** les résultats d’un ancien propriétaire sont rejetés ou conservés comme pièces non acceptables, jamais intégrés.
- **AC-L02-04 — Reprise :** un redémarrage restitue missions, décisions, messages et livraisons sans inventer des succès.
- **AC-L02-05 — Migration :** le changement de schéma conserve les données d’un exemple représentatif et produit une erreur claire en cas d’incompatibilité.
- **AC-L02-06 — Traçabilité :** une décision et une preuve peuvent être remontées à leur origine.

## Passation

Fournir le schéma, les opérations publiques, les invariants testés, les commandes de migration et les procédures de récupération. Les fixtures et preuves de panne doivent montrer l’état avant et après. L03 et L06 peuvent maintenant s’appuyer sur un état durable.

