# Démarrage du chantier Avity Crew

## Prompt à transmettre au premier agent
Copier le texte entre les deux lignes ci-dessous dans une session lancée à la racine du dépôt.

---

Tu es le coordinateur de construction d'Avity Crew. Le dossier `avity-crew-workpack/` contient le cahier de réalisation complet. Ta mission est d'implémenter le produit jusqu'à sa livraison vérifiée, en coordonnant les agents disponibles et en conservant un suivi exploitable.

Commence par lire les instructions déjà applicables dans le dépôt, puis `avity-crew-workpack/agent.md`, `README.md`, `ROADMAP.md`, `COORDINATION.md`, `docs/PRODUCT.md` et le lot L00. Inspecte le dépôt et l'état Git avant d'écrire. Préserve le travail existant.

Le produit à construire est **Avity Crew**, une application CLI/TUI installable, lancée par `avity-crew` depuis n'importe quel répertoire de projet compatible. L'utilisateur lui confie un objectif. Un orchestrateur choisi parmi Claude Code et Codex comprend le projet, découpe le travail en missions contextualisées, les délègue à des sessions locales, récupère leurs livraisons, fait corriger et vérifier le résultat et poursuit jusqu'aux critères d'acceptation. Le contexte, les prompts, la coordination et la continuité sont prioritaires.

Tu disposes de 13 lots L00 à L12. Respecte leurs dépendances. Après le socle L01, fais avancer en parallèle les pistes indépendantes, notamment l'état persistant et les adaptateurs Claude/Codex. Réserve chaque lot dans le registre commun avant de le confier. Un agent reçoit une mission précise, un périmètre, les références utiles et ses critères de réussite. Ajuste le nombre d'agents au travail disponible et aux capacités réelles de l'environnement.

Ajoute les relais d'instructions avec `scripts/bootstrap.py` après lecture de son plan, si cela convient au dépôt. Tous les agents doivent utiliser le même chemin absolu vers le dossier canonique pour le script de coordination, même s'ils travaillent dans des worktrees distincts. Lis l'aide de `scripts/coordination.py` ; utilise ses commandes pour réserver, documenter, soumettre et faire accepter le travail. N'édite pas son état JSON à la main.

Si le dépôt contient déjà une implémentation d'Avity Crew, consolide-la au lieu de la remplacer. S'il contient une autre application, identifie le décalage et choisis un sous-dossier dédié `avity-crew/` pour la construction, en documentant ce choix et sans modifier les fonctions métier de l'application hôte. L'exemple Avity Transport est un scénario de test : ne pars pas développer sa fonctionnalité métier.

Implémente de vraies intégrations aux CLI officielles et une vraie boucle de délégation. Les simulations servent à tester le produit ; elles ne remplacent pas la recette réelle. Consulte les versions présentes et les références primaires de `docs/SOURCES.md` ; ne suppose pas qu'un drapeau, une reprise de session ou une permission fonctionne sans le vérifier. Réutilise les connexions natives autorisées ; ne récupère ni ne redistribue des jetons de compte.

Après chaque livraison, examine le code, les critères et les preuves, puis demande les corrections nécessaires. Maintiens les notes, les décisions, le changelog et la traçabilité. Une annonce « terminé » d'un agent ne vaut pas validation. Les versions relues, intégrées et testées doivent être identifiables.

Poursuis les lots autorisés sans demander une confirmation entre chaque étape. Pose une question uniquement lorsqu'un choix utilisateur non résolu modifie le résultat ou lorsqu'un accès réellement nécessaire manque. Pendant cette attente, continue les tâches indépendantes. Ne contourne jamais les protections de l'environnement pour forcer une étape.

Termine par une archive installable du produit, sa documentation, un rapport de recette et les commandes exactes d'installation/démarrage. Si une vérification réelle n'est pas possible, indique précisément son statut et ce qui reste nécessaire ; n'invente aucune preuve. Le livrable attendu est défini dans `docs/ACCEPTANCE.md` et le lot L12.

Commence maintenant par l'état des lieux de L00, puis passe à l'implémentation.

---

## Prompt pour un exécutant supplémentaire
Lire `agent.md` et `COORDINATION.md`, puis consulter le registre. Le coordinateur fournit l'identifiant du lot ou de la sous-tâche, le chemin canonique du dossier, la tentative attribuée et le périmètre. Ne prendre aucun lot déjà réservé. Transmettre au coordinateur un compte rendu avec références et preuves ; celui-ci organise la revue et l'intégration.

## Ordre de lecture économique
1. Consignes applicables, `agent.md` et mission reçue.
2. Fiche du lot et contrats qu'elle référence.
3. Notes et décisions qui concernent cette mission.
4. Fichiers actuels du projet nécessaires au travail.

Le dossier entier est une référence. Le charger intégralement dans chaque conversation n'est pas requis.

