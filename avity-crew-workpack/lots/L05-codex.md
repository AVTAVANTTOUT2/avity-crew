# L05 — Adaptateur Codex réel

**Dépendances :** [L01](L01-socle-contrats.md).  
**Résultat :** une intégration Codex utilisable comme exécutant ou orchestrateur, avec un contrat normalisé.  
**Propriétaire conseillé :** agent intégration Codex.

**Références :** [consignes de construction](../agent.md), [PROVIDERS](../docs/PROVIDERS.md), [DATA_MODEL](../docs/DATA_MODEL.md).

## Objectif

Utiliser le Codex local installé par l’utilisateur avec ses interfaces officiellement prises en charge. Choisir et documenter la voie d’intégration de la V1 selon les capacités nécessaires : mode non interactif structuré ou App Server. Ne pas mélanger plusieurs propriétaires concurrents d’une même session.

## Travail à réaliser

1. Détecter le binaire et sa version. Vérifier les commandes, options et méthodes dans l’aide locale et la documentation officielle actuelle. Toute voie supprimée ou expérimentale doit être identifiée et évitée ou encadrée par une décision motivée.
2. Implémenter le démarrage d’une mission dans son répertoire de travail avec événements structurés. Passer les arguments directement au processus et éviter la construction d’une chaîne shell contenant le prompt.
3. Récupérer l’identifiant du thread ou de la session, les événements et le résultat final. Normaliser les changements de fichiers, commandes, demandes, erreurs et indicateurs réellement disponibles sans coupler le domaine aux types Codex bruts.
4. Gérer les lectures fragmentées, les sorties volumineuses et les notifications non connues. Avec App Server, respecter le handshake et distinguer requêtes, réponses et notifications. Avec le mode non interactif, respecter le format de flux effectivement documenté.
5. Implémenter la continuation ou reprise par identifiant explicite. Ne jamais utiliser une reprise ambiguë de « la dernière session » pour une équipe concurrente.
6. Préserver l’authentification native et sélectionner uniquement les modèles accessibles. Ne pas copier les caches de connexion dans le projet, les logs ou les worktrees. Une absence d’accès devient un état identifiable.
7. Préparer le raccordement aux outils d’équipe de L07. Vérifier dès ce lot la configuration et un appel réel à un bridge MCP minimal de test ; L07 acceptera le raccordement complet aux outils du produit. Distinguer les outils exposés à Codex du protocole permettant de piloter Codex lui-même ; ce ne sont pas nécessairement les mêmes interfaces.
8. Implémenter interruption, sortie et classification des erreurs. La politique du run définit permissions et décisions automatiques autorisées ; les demandes non résolues sont remontées au superviseur.

## Capacités et compatibilité

Publier une matrice incluant lancement, reprise, interruption, messages pendant un tour, demandes de permission, outils externes et usage mesuré. Les capacités optionnelles manquantes ne sont pas émules par des saisies de terminal fragiles.

Si la voie choisie ne permet pas une question interactive, L07 doit utiliser un canal documenté ou terminer le tour et reprendre avec la réponse. Le comportement de repli doit être explicite et testé.

## Périmètre et parallélisation

Ce lot possède l’adaptateur Codex, ses erreurs et ses fixtures. Il avance en parallèle de L02 et L04 à partir des types L01. Toute extension nécessaire au contrat partagé est proposée à son propriétaire avant d’être utilisée par plusieurs modules.

## Vérifications

Tester un flux avec plusieurs sessions concurrentes, des lignes tronquées, un événement inconnu, une erreur fournisseur et une interruption. Effectuer un essai live borné dans un dépôt jetable lorsque l’accès est disponible : modification réelle, capture de session, reprise ciblée avec nouvelle note et vérification de la modification.

## Critères d’acceptation

- **AC-L05-01 — Normalisation :** les événements Codex alimentent le contrat commun sans perte des identifiants indispensables.
- **AC-L05-02 — Concurrence :** deux sessions ne mélangent ni événements, ni prompts, ni reprises.
- **AC-L05-03 — Reprise ciblée :** une mission reprend le bon identifiant et reçoit les informations nouvelles.
- **AC-L05-04 — Arrêt :** l’interruption ne produit pas de faux succès et laisse un état récupérable.
- **AC-L05-05 — Preuve réelle :** un travail effectif et son résultat sont observés avec la version documentée.

## Passation

Fournir la voie retenue, sa justification, les versions et capacités testées, les fixtures et les résultats live. En l’absence du binaire ou du compte, inscrire `live_unverified` avec le prérequis exact. La recette finale reste ouverte jusqu’à une vérification réelle.

