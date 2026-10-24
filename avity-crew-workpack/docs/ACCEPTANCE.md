# Recette et définition de terminé

## 1. Règle de livraison
Une V1 est fonctionnelle sur une plateforme donnée lorsqu'un utilisateur peut installer le package, ouvrir un projet, donner un objectif, faire travailler les providers réels, reprendre après incident et obtenir une livraison vérifiée. La couverture globale est détaillée dans [TRACEABILITY.md](TRACEABILITY.md).

Le présent dossier n'exécute aucune de ces recettes applicatives. Ses tests concernent seulement le pack et son utilitaire de chantier.

## 2. Trois niveaux de preuves
| Niveau | Ce qu'il démontre | Limite |
|---|---|---|
| Statique/contrats | Types, schémas, liens, compilation et règles déterministes | Ne prouve pas une conversation native |
| Simulation/intégration locale | États, séquences, erreurs et reprise reproductibles | Ne prouve pas les capacités des CLI installées |
| Live | Échanges et modifications avec les fournisseurs réellement disponibles | Consomme leurs ressources ; dépend des versions et accès vérifiés |

Toutes les preuves indiquent leur niveau. Les données de démonstration n'entrent jamais dans le rapport des essais réels.

## 3. Environnement de recette
Utiliser un dépôt temporaire ou une copie isolée sans secrets ni données de production. Capturer version d'Avity Crew, Node, OS, architecture, Git, CLI fournisseurs, providers/modèles, permissions effectives et révision candidate. Les identifiants natifs et logs sont expurgés lorsque nécessaire.

Prévoir deux projets sans état partagé involontaire, dont un dans un chemin avec espaces. Les fixtures comprennent un dépôt initialisé, un répertoire vide, un projet avec changements utilisateur et un projet de planning fictif.

## 4. Scénarios de bout en bout obligatoires
### E2E-01 — Nouvelle application
Depuis un dossier vide, demander une petite application locale dont les critères sont déterministes. Le chef produit le plan et délègue au moins deux missions utiles. Vérifier construction, exécution locale, fonctions convenues, rapport et documentation. Aucun service externe ou paiement n'est nécessaire.

### E2E-02 — Feature existante
Utiliser [../examples/transport-scenario.md](../examples/transport-scenario.md). Établir les décisions métier du scénario, puis réaliser backend, interface et validation. Vérifier persistance, droits, conflit de création et préservation du parcours existant. Les noms de fichiers viennent de la fixture créée pour le test, pas d'une connaissance supposée d'Avity Transport.

### E2E-03 — Chef interchangeable
Exécuter un objectif avec Claude chef et un exécutant Codex, puis un objectif avec Codex chef et un exécutant Claude. Le code métier de l'orchestration reste identique. Enregistrer les versions et la transmission effective des outils de coordination.

### E2E-04 — Boucle de correction
Introduire une erreur contrôlée détectable par un test indépendant. Le chef reçoit la livraison, la validation échoue, une correction ciblée est créée puis vérifiée. Le run reste incomplet avant la correction. Le test vérifie la correction du défaut, pas le texte de satisfaction d'un agent.

### E2E-05 — Contexte actualisé
Modifier une décision ou un contrat entre deux missions. L'agent concerné reçoit la nouvelle version, l'ancienne est marquée remplacée et l'action produite respecte la décision actuelle. Un agent non concerné ne reçoit pas l'intégralité des conversations.

### E2E-06 — Reprise et fermeture
Fermer et rouvrir la TUI ; interrompre un exécutant ; redémarrer le service après une opération initiée. Préserver les changements et éviter un doublon d'attribution ou d'intégration. Réconcilier les effets incertains. Rejeter une livraison tardive de l'ancienne tentative.

### E2E-07 — Sept sessions
Vérifier une capacité de sept sessions actives chef compris avec un scénario léger et des missions indépendantes. Le test ne doit pas créer artificiellement sept modifications conflictuelles. Vérifier l'attribution des ressources, le routage des événements et la limite configurée. Les tests intensifs de concurrence peuvent être simulés ; le rapport distingue la capacité simulée de la capacité réellement observée.

### E2E-08 — Quota, permission et question
Simuler de manière déterministe une limite fournisseur et un refus de permission ; vérifier état, message visible, poursuite des tâches indépendantes et reprise. Sur chaque provider réel, vérifier au moins le diagnostic et un cas de permission contrôlé supporté, sans provoquer un dépassement réel de quota. Une question utilisateur reçoit une réponse reliée à la bonne décision.

### E2E-09 — Intégration cohérente
Deux livraisons valides isolément produisent volontairement une incompatibilité une fois réunies. Le candidat échoue, la branche stable reste préservée et une tâche correctrice est ouverte. Après correction, les preuves visent le nouveau candidat.

### E2E-10 — Installation et deux projets
Exécuter `npm pack`, installer le tarball dans un préfixe temporaire propre, lancer le binaire depuis deux projets et vérifier qu'aucun chemin vers le dépôt de développement n'est requis. Inclure templates, migrations et bridge dans le package. Tester désinstallation et redémarrage sans perdre les données utilisateur conservées.

### E2E-11 — Livrable documentaire sans Git
Dans un dossier documentaire sans dépôt Git, demander un livrable vérifiable à partir de sources locales non sensibles. La mission utilise `base_revision: null`, une livraison référencée par empreinte, une revue et des vérifications adaptées. `accept_delivery` peut accepter le résultat sans créer un commit artificiel. Une inspection manuelle sans commande utilise `command: null` avec une preuve d'observation. Le chef ne doit pas attendre l'acceptation de son identité de contrôle pour clore le run.

### E2E-12 — Une seule place active
Configurer `max_active_agents: 1`. Le chef crée une mission et termine son tour ; l'exécutant utilise ensuite la place, livre, puis le chef reprend. Aucun appel de délégation ne doit attendre un exécutant tout en occupant la seule place disponible.

## 5. Tests de risque à prévoir
- Graphe cyclique refusé ; dépendances indisponibles non lancées.
- Deux délégations concurrentes : une seule attribution.
- Rejeu de mutation : pas de double effet.
- Rapport incomplet ou venant d'une ancienne génération : refus.
- Contexte trop long : politique de réduction sans retirer les critères ou décisions obligatoires.
- Source modifiée : bundle signalé obsolète et mise à jour traçable.
- Événement tronqué, non JSON, UTF-8 fragmenté ou inconnu : parseur robuste.
- Sorties abondantes : mémoire bornée et aucune perte silencieuse d'un résultat terminal.
- Tentative d'action hors rôle/projet : refus du service.
- Changement externe de la branche cible : recalcul de l'intégration.
- Chemin symbolique, chemin avec espaces, workspace sale et collisions de port : préservation.
- Rapport contenant un secret de fixture : expurgation avant affichage/export.

## 6. CI attendue
Installer avec lockfile, vérifier format/lint/types, tests unitaires et intégration sur faux providers, construction et smoke du package. Mettre les workflows en place dès L01 puis les enrichir seulement lorsqu'un risque le demande.

Les recettes live sont explicites et locales ou sur un runner privé autorisé. Une CI sans identifiants ne les exécute pas et ne les marque pas réussies. Les workflows ne récupèrent pas des secrets pour du code de contribution non fiable.

## 7. Preuve de chaque scénario
Fournir identifiant, version/commit, environnement, mode simulated/live/static, commande réelle, résultat, timestamps, critères couverts et référence des logs. Pour l'intégration, relier base, source, candidat, tests et version livrée. Utiliser [../templates/RELEASE_REPORT.md](../templates/RELEASE_REPORT.md).

Un résultat `not_run` ou `blocked` reste visible. Si la plateforme supplémentaire n'est pas disponible, la documentation la marque non vérifiée ; aucune garantie générale n'est déduite d'une seule plateforme. Le rapport final indique précisément la plateforme de recette sur laquelle la V1 a été validée.

## 8. Checklist de clôture
- [ ] L00 à L12 acceptés avec preuves et correspondance aux exigences.
- [ ] Commande installée, contexte cwd et isolation des projets vérifiés.
- [ ] Claude et Codex utilisés comme chef et comme exécutant.
- [ ] Au moins une fonctionnalité produite par une équipe réelle puis corrigée/validée.
- [ ] Reprise, changement de chef, messages et notes vérifiés.
- [ ] Intégration testée sur la révision livrée.
- [ ] Capacité de concurrence et limites observées rapportées.
- [ ] Documentation utilisateur, installation, dépannage et changelog à jour.
- [ ] Tarball local, rapport de recette et limitations disponibles.
- [ ] Aucune publication ou mise en production déclarée sans exécution autorisée et preuve.

Les cases restent ouvertes dans le dossier initial. Le résultat de la validation de ce pack ne les coche pas.

