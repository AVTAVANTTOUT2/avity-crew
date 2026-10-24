# L04 — Adaptateur Claude Code réel

**Dépendances :** [L01](L01-socle-contrats.md).  
**Résultat :** une intégration Claude Code utilisable par le superviseur, avec capacités et limites explicites.  
**Propriétaire conseillé :** agent intégration Claude.

**Références :** [consignes de construction](../agent.md), [PROVIDERS](../docs/PROVIDERS.md), [DATA_MODEL](../docs/DATA_MODEL.md).

## Objectif

Piloter le binaire Claude Code installé et authentifié par son utilisateur, au moyen d’interfaces officielles documentées. L’adaptateur doit conserver la distinction entre processus, session de conversation, tour et mission. Il ne simule pas un succès lorsqu’une capacité manque.

## Travail à réaliser

1. Détecter le binaire, sa version et les capacités nécessaires à partir de l’aide et de la documentation officielle de la version retenue. Rendre un diagnostic clair si le logiciel manque ou si sa version n’est pas couverte.
2. Implémenter le lancement non interactif à sorties structurées. Passer les arguments sans concaténer une commande shell ; transmettre les prompts par un mécanisme sûr et compatible avec leur taille.
3. Identifier la session produite et normaliser les événements utiles : début, message, outil, demande de permission ou question, résultat, interruption et erreur. Supporter des lignes fragmentées sur plusieurs lectures, les événements inconnus et les sorties d’erreur séparées.
4. Conserver les événements bruts nécessaires au diagnostic avec filtrage des secrets. Les données de raisonnement non fournies par le produit ne sont ni inventées ni requises.
5. Implémenter la continuation ciblée et la reprise par identifiant lorsque la version le permet. Une reprise conserve le contexte propre au fournisseur, mais reçoit explicitement le nouveau contexte d’équipe. Documenter les paramètres qui ne peuvent pas être changés immédiatement.
6. Implémenter une interruption graduelle et le suivi de l’arbre de processus. Distinguer fin d’un tour, sortie du processus et mission réellement livrée.
7. Préparer le raccordement aux outils d’équipe du futur bridge L07, dans un périmètre propre au projet et à la session. Vérifier dès ce lot la configuration et un appel réel à un bridge MCP minimal de test ; le raccordement complet aux outils du produit sera accepté en L07. Les identifiants et accès natifs restent gérés par le fournisseur ; ne pas les exporter dans les notes ou le dépôt.
8. Classer les erreurs d’authentification, quota, réseau, permission et protocole. Les politiques de reprise appartiennent au superviseur ; l’adaptateur retourne les faits observés.

## Permissions et limitations

N’ajouter aucun contournement global de permissions pour obtenir une démonstration fluide. Les règles sont définies par le run et traduites vers les mécanismes effectivement supportés. Une demande nécessitant une réponse devient un événement exploitable et ne reste pas silencieusement bloquée.

Les capacités facultatives sont détectées : ajout de consignes pendant un tour, statistiques d’usage ou reprise d’une conversation existante. Une valeur inconnue reste inconnue, notamment pour le coût ou le quota.

## Périmètre et parallélisation

Ce lot possède exclusivement l’adaptateur Claude et ses fixtures de protocole. Il peut avancer en parallèle de L02 et L05. Le superviseur de L07 reste responsable de l’affectation des tâches et du stockage des références de sessions.

## Vérifications

Prévoir des tests déterministes de parsing et d’erreurs avec des fixtures identifiées. Réaliser également, quand le binaire authentifié est disponible et autorisé, un essai live borné : une petite modification dans un projet jetable, récupération de la session, continuation avec une note, contrôle du résultat et interruption d’une opération contrôlée.

## Critères d’acceptation

- **AC-L04-01 — Flux :** fragmentation, événements inconnus et erreurs ne mélangent pas texte et protocole.
- **AC-L04-02 — Identité :** chaque événement reste rattaché à la bonne session et à la bonne tentative.
- **AC-L04-03 — Reprise :** l’essai réel reprend l’identifiant voulu et reçoit la nouvelle consigne.
- **AC-L04-04 — Contrôle :** les demandes de permission et interruptions ont un résultat explicite.
- **AC-L04-05 — Preuve réelle :** au moins un travail effectif est observé avec la version documentée.

## Passation

Livrer la matrice de capacités, les versions testées, les erreurs normalisées et les preuves. Si le compte ou le binaire n’est pas disponible, noter `live_unverified` et le prérequis manquant. Les tests simulés peuvent permettre de développer L07, mais ne suffisent pas à valider la V1 finale.

