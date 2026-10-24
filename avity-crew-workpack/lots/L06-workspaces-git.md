# L06 — Espaces de travail, Git et ressources locales

**Dépendances :** [L02](L02-etat-persistant.md).  
**Résultat :** des missions concurrentes travaillent sans écraser leurs fichiers et leurs livraisons peuvent être réunies de façon contrôlée.  
**Propriétaire conseillé :** agent Git / exécution.

**Références :** [consignes de construction](../agent.md), [ARCHITECTURE](../docs/ARCHITECTURE.md), [ORCHESTRATION](../docs/ORCHESTRATION.md).

## Objectif

Attribuer à chaque tentative un espace identifiable et intégrer les changements sur une révision vérifiable. Les worktrees séparent les dossiers de travail ; la maîtrise des permissions et des ressources communes doit être traitée explicitement.

## Travail à réaliser

1. Détecter la racine réelle du projet, Git et les modifications existantes. Ne pas réinitialiser, stasher, nettoyer ou committer les changements de l’utilisateur sans décision explicite. Définir un mode de démarrage compatible avec un dépôt sale.
2. Créer une branche et un worktree par mission qui modifie du code, à partir d’une révision enregistrée. Prévoir aussi les missions en lecture seule et les dossiers nouveaux sans dépôt : l’initialisation Git éventuelle est explicite.
3. Conserver la correspondance projet, mission, tentative, branche, chemin et révision de départ. Les chemins ne doivent pas dépendre d’un emplacement d’installation fixe d’Avity Crew.
4. Attribuer les ressources locales qui peuvent entrer en conflit : ports, répertoires temporaires, bases de test et identifiants de services. Réserver les opérations réellement exclusives, notamment certains fichiers partagés ou migrations.
5. Collecter les changements livrés, vérifier leur périmètre et produire un commit ou patch immuable. Une livraison n’est pas une référence flottante à un répertoire encore modifié par son agent.
6. Implémenter une file d’intégration avec un seul écrivain. Préparer le résultat combiné sur une branche dédiée, lui associer les vérifications, puis avancer la référence validée seulement si les conditions sont remplies.
7. En cas de conflit, conserver les deux contributions et ouvrir une mission de résolution avec les informations nécessaires. Aucune résolution automatique ne doit supprimer silencieusement une intention métier.
8. Définir conservation, sauvegarde et nettoyage des espaces. Un arrêt ou une livraison refusée ne doit pas provoquer la suppression du travail non intégré.

## Contrats et invariants

Les références revues, testées et intégrées doivent être identifiables. Une preuve sur une ancienne combinaison ne valide pas automatiquement la suivante. Un changement après revue invalide les contrôles concernés selon leur portée.

Les réservations applicatives réduisent les collisions, mais elles ne constituent pas une sandbox de sécurité. Les accès effectifs des processus sont décrits et contrôlés par les mécanismes retenus ; leur absence doit être affichée comme telle.

## Périmètre et parallélisation

Ce lot possède le cycle des workspaces, la collecte des livraisons et les opérations Git sérialisées. Il consomme les tâches et baux de L02. Le superviseur de L07 demande ces opérations ; il ne lance pas ses propres commandes de fusion en concurrence.

## Vérifications

Créer deux modifications compatibles puis deux modifications en conflit dans des dépôts jetables. Tester chemins avec espaces, dépôt sale, interruption avant intégration, échec d’un test sur la combinaison et reprise de nettoyage. Vérifier la non-perte des fichiers non intégrés.

## Critères d’acceptation

- **AC-L06-01 — Séparation :** deux missions modifient leurs dossiers sans écrasement direct.
- **AC-L06-02 — Ressources :** les ports et bases de test utilisés simultanément sont distincts ou explicitement réservés.
- **AC-L06-03 — Intégration :** les preuves de validation portent sur le résultat combiné exact.
- **AC-L06-04 — Conflit :** un conflit conserve les contributions et produit un état exploitable.
- **AC-L06-05 — Préservation :** dépôt sale, arrêt et nettoyage ne suppriment pas les changements de l’utilisateur ou d’une mission.
- **AC-L06-06 — Idempotence :** la répétition d’une demande d’intégration n’applique pas deux fois la livraison.

## Passation

Livrer procédures de création, livraison, intégration, résolution et nettoyage, ainsi que les preuves des scénarios. Documenter précisément le niveau d’isolation obtenu et les ressources qui restent communes.

