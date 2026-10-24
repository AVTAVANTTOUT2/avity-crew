# L09 — CLI et interface terminal orientées objectif

**Dépendances :** [L08](L08-orchestration.md).  
**Résultat :** l’utilisateur lance Avity Crew dans un dossier et pilote un vrai objectif depuis une interface utilisable.  
**Propriétaire conseillé :** agent expérience terminal.

**Références :** [consignes de construction](../agent.md), [CLI](../docs/CLI.md), [ORCHESTRATION](../docs/ORCHESTRATION.md).

## Objectif

Rendre la boucle de L08 accessible et compréhensible. Le terminal présente l’objectif, l’équipe, le contexte et les livraisons. Il commande le superviseur existant et ne crée pas une seconde logique d’orchestration.

## Travail à réaliser

1. Fournir la commande `avity-crew`, son aide et un diagnostic `doctor`. Détecter le répertoire courant, la racine du projet et les sessions déjà connues. L’installation globale du logiciel ne détermine pas l’emplacement du projet utilisateur.
2. Permettre de créer ou reprendre un objectif, choisir le chef et les modèles accessibles, régler la concurrence et préciser les contraintes. Les paramètres effectifs doivent être consultables.
3. Proposer une conversation avec le chef et une présentation de son activité. Les réponses utilisateur aux questions restent liées à leur demande d’origine.
4. Afficher les missions, dépendances, responsables, états et résultats. Différencier travail actif, attente d’une dépendance, demande de précision, limite fournisseur, erreur et livraison en revue.
5. Ajouter les vues de contexte envoyé, décisions, notes, diff et preuves. Les gros historiques sont paginés ou filtrables ; l’interface reste utilisable avec sept agents.
6. Exposer les actions de pause, reprise, interruption, message ciblé et changement de chef. Chaque action confirme son résultat observé ; une requête envoyée n’est pas immédiatement annoncée comme accomplie.
7. Gérer les interfaces non interactives : commandes de statut et sorties structurées pour scripts, sans couleurs imposées. Définir des codes de sortie distincts pour échec, interruption et résultat non vérifié.
8. Gérer redimensionnement, petit terminal, saisie multiligne, Unicode et chemins avec espaces. Préserver l’entrée utilisateur lors d’une arrivée d’événements.

## Information utile à l’utilisateur

Le statut doit indiquer ce qui est terminé, ce qui avance, le blocage éventuel et la prochaine action. Les statistiques ne sont affichées que lorsqu’elles sont connues ; une estimation de coût reste étiquetée comme estimation. Les journaux techniques détaillés sont consultables sans encombrer la conversation principale.

L’ouverture d’une session native ou la reprise en main interactive dépend des capacités de l’adaptateur. Le contrôle passe explicitement d’un acteur à l’autre ; l’interface ne laisse pas le chef et l’utilisateur écrire simultanément dans une même session sans coordination.

## Périmètre et parallélisation

Ce lot possède les interactions terminal et la présentation. Les contrats du service, les règles métier et les transitions restent dans les lots précédents. Une interface graphique web n’est pas nécessaire pour accepter la V1.

## Vérifications

Tester une demande depuis un dossier existant, une reprise depuis un autre terminal, une question du chef, un agent bloqué et un objectif terminé. Exercer les actions par une interface simulée déterministe, puis vérifier manuellement un parcours réel enregistré. La capture visuelle ne suffit pas sans état du service correspondant.

## Critères d’acceptation

- **AC-L09-01 — Dossier courant :** le bon projet est reconnu indépendamment du chemin d’installation.
- **AC-L09-02 — Commande complète :** une demande utilisateur lance le vrai parcours L08 et en affiche le résultat.
- **AC-L09-03 — États exacts :** aucune attente ou erreur n’est présentée comme réussite.
- **AC-L09-04 — Inspection :** l’utilisateur retrouve le contexte d’une mission et les preuves de sa livraison.
- **AC-L09-05 — Ergonomie :** redimensionnement, saisie et événement simultanés ne rendent pas la session inutilisable.
- **AC-L09-06 — Scripts :** les sorties structurées et codes de sortie sont stables et documentés.

## Passation

Livrer commandes, raccourcis, vues, codes de sortie et preuves d’usage. Référencer les limites d’interface réellement rencontrées et le comportement prévu en absence d’une capacité fournisseur.

