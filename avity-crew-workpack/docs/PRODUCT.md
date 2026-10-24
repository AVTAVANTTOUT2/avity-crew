# Produit à construire

## Intention
Avity Crew permet à Elias de déléguer un objectif complet à une équipe de sessions IA locales. Il lance `avity-crew` dans un répertoire, décrit le résultat et les contraintes, puis dialogue avec un orchestrateur. Celui-ci lit le projet, prépare des missions contextualisées, les répartit, récupère les travaux, organise les corrections et valide la livraison.

La fonction centrale est la boucle **comprendre → préparer le contexte → déléguer → recueillir → vérifier → adapter → livrer**. La qualité est mesurée par le résultat accepté et les interventions utiles de l'utilisateur.

## Utilisateurs et vocabulaire
- **Utilisateur** : propriétaire de l'objectif, décide des arbitrages importants.
- **Orchestrateur** : rôle de direction tenu par une session Claude Code ou Codex, interchangeable.
- **Exécutant** : session chargée d'une mission bornée, avec un rôle adapté.
- **Projet** : répertoire cible et ses instructions, sources, décisions et environnement.
- **Run** : objectif utilisateur et cycle de réalisation associé.
- **Tâche** : unité de résultat avec critères, dépendances et livrable.
- **Tentative** : exécution d'une tâche par une session donnée ; plusieurs tentatives peuvent se succéder.
- **Livraison** : résultat référencé, preuves et informations pour la suite.
- **Session native** : conversation identifiable dans le logiciel fournisseur lorsque celui-ci expose cet identifiant.

Un moteur n'est pas un rôle : Claude Code, Codex et les futurs connecteurs peuvent tenir plusieurs rôles selon leur capacité.

## Parcours principal
1. L'application identifie le répertoire canonique et le projet. Sans projet initialisé, elle propose un diagnostic bref et crée ses métadonnées locales à la demande ou au lancement autorisé.
2. L'utilisateur choisit le chef et sa préférence de modèle parmi ceux réellement disponibles. La configuration précédente est réutilisable.
3. Il formule un objectif libre, éventuellement accompagné de fichiers et de contraintes.
4. Le chef examine le contexte existant et repère les incertitudes qui changent le résultat. Il continue les tâches indépendantes si une question reste ouverte.
5. Il définit les critères de fin et le mode de livraison, puis crée le graphe de missions.
6. Le superviseur vérifie les dépendances, prépare contexte et espaces, puis lance les sessions.
7. Les agents produisent événements, notes et livraisons. Les messages utiles sont transmis aux bons destinataires.
8. Le chef examine les résultats, demande les corrections et fait vérifier le résultat combiné.
9. L'utilisateur reçoit un compte rendu fondé sur les preuves : obtenu, vérifié, livré, limitations.

## Exigences obligatoires V1
### Contexte
Le contexte comporte connaissances du projet, objectif en cours, mission précise et actualités utiles. Les éléments ont une provenance et une version. Les observations, hypothèses et décisions retenues sont distinctes. Un agent peut demander les détails manquants. Le système montre ce qui lui a été envoyé.

### Orchestration
Le chef crée et attribue des tâches, consulte l'état, transmet une information, collecte une livraison, pose une question et propose une intégration. Il adapte le plan à partir des résultats. Il peut demander une revue, une validation ou un refactoring ciblé. Une tâche de CI est créée lorsqu'un besoin est identifié. La limite de concurrence est configurable, avec sept agents actifs proposés chef compris.

### Agents réels
Claude Code et Codex doivent être intégrés par leurs interfaces effectivement disponibles. Le rôle de chef doit fonctionner avec chacun. Les autres sessions peuvent utiliser l'un ou l'autre. Les connexions natives restent gérées par chaque CLI. Les simulations ont un nom et un mode explicites.

### État et continuité
L'état des runs, tâches, tentatives, messages, décisions et preuves survit aux redémarrages. Le service réconcilie le travail interrompu avant une reprise. La fermeture de l'interface n'est pas un ordre de fermeture de toute l'équipe. Une machine éteinte n'exécute plus ses processus.

### Collaboration sur le code
Les modifications sont réparties par périmètre, préparées dans des espaces distincts et réunies avec une procédure d'intégration. Les risques de contrat et de ressources communes sont gérés. Les preuves de test se rattachent au résultat réellement évalué.

### Interface
Lancement depuis le répertoire courant, conversation avec le chef, tableau des agents/tâches, questions, messages, contexte inspectable, livraisons et état des vérifications. Fournir un mode texte/JSON utilisable sans terminal interactif. L'utilisateur peut suspendre le run, interrompre une tentative, réattribuer, reprendre et changer de chef.

### Documentation et livraison
Guides d'installation, d'utilisation et de dépannage ; configuration documentée ; dossier de recette ; package local installable ; commande vérifiée depuis plusieurs projets. Les limitations de plateforme, permissions et fournisseurs sont visibles.

## Critères qui empêchent un faux « terminé »
- Une sortie de processus réussie n'est pas une preuve de réussite métier.
- Un rapport valide syntaxiquement n'est pas une preuve que son contenu est vrai.
- Des tests simulés ne prouvent pas une intégration fournisseur réelle.
- Des branches valides séparément ne prouvent pas le fonctionnement de leur combinaison.
- Le code produit et son déploiement sont deux états distincts.
- Les critères d'acceptation ne sont pas retirés pour masquer un échec.

Le moteur applique ces distinctions dans ses transitions et l'interface les explique en termes simples.

## Choix de périmètre
La V1 fonctionne sur un hôte local avec macOS, Linux ou WSL comme cibles à vérifier. Git est requis pour les missions de modification de dépôt ; un dossier nouveau peut être initialisé selon la demande. Une mission documentaire peut utiliser des artefacts de fichiers sans prétendre avoir une intégration Git.

Cursor, interface web, routage vers des API externes et exécution distribuée sur plusieurs hôtes ne sont pas nécessaires pour fermer la V1. Les ports d'extension sont prévus. Toute extension doit conserver les mêmes tâches, contextes et preuves.

Les secrets, comptes partagés, contournements de quotas et publication automatique d'un paquet ne font pas partie de l'autorisation donnée par ce dossier.

## Scénarios de référence
- Créer une application simple dans un répertoire vide, avec des contraintes utilisateur.
- Ajouter une feature dans un projet existant en préservant les parcours actuels.
- Diagnostiquer et corriger un défaut avec reproduction et vérification.
- Faire évoluer plusieurs parties indépendantes d'un dépôt puis valider l'ensemble.
- Remplacer un chef ou un exécutant et reprendre le travail sans reconstituer son historique manuellement.

Voir [ACCEPTANCE.md](ACCEPTANCE.md) et [../examples/transport-scenario.md](../examples/transport-scenario.md).

## Choix initiaux à confirmer en L00
Réutiliser le code existant compatible. Sinon partir sur TypeScript strict, Node.js 24 LTS, npm workspaces, SQLite local, un processus superviseur et une TUI. Les versions exactes sont figées avec le lockfile après inspection, pas inventées dans ce dossier. Toute divergence est justifiée dans une décision et propagée aux contrats concernés.

