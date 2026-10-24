# Changelog

## 0.1.0 — Candidat local

- L00 : racine et outils audités, interfaces CLI et reprises minimales réelles
  vérifiées séparément ; cadrage accepté par une session indépendante.
- L01 : socle TypeScript, contrats versionnés, adaptateur de simulation et CI.
  Accepté après revue indépendante, 12 tests Node 24/26.
- L02 : stockage SQLite transactionnel, générations, journal, sauvegarde et
  tests à plusieurs processus ; livraison acceptée.
- L03 : inspection ciblée du projet, sources versionnées, compilation de prompts,
  budgets explicites et expurgation des valeurs sensibles ; livraison acceptée.
- L04/L05 : adaptateurs Claude Code et Codex, événements structurés, reprise ciblée,
  pont MCP et interruptions ; livraisons acceptées avec recettes propres aux adaptateurs.
- L06 : workspaces et ressources isolés, snapshots, candidat vérifié et promotion
  locale par référence Git ; livraison acceptée.

### Fonctions livrées

- Service HTTP local authentifié, outils MCP/CLI partageant les mêmes contrats,
  coordination persistante et chef indépendant du graphe des tâches.
- CLI asynchrone, conversation multiligne, vue détachable, choix du chef,
  questions, messages ciblés, inspection de contexte et exports.
- Contrôles de revue, versions, rejouabilité, attente utilisateur et annulation
  d'un lancement encore en préparation ; scénarios HTTP/SQLite avec providers simulés.
- Reprise explicite et contrôles d'identité des processus POSIX ; les issues
  ambiguës restent signalées au lieu d'être présentées comme un arrêt confirmé.
- Relecture de la configuration complète au démarrage du service, avec
  conservation de l'historique du projet et des choix propres aux runs existants.
- Correction de tâches par `amend_task`, liée à une décision approuvée et à une
  révision auditée ; l'objectif et les critères globaux du run restent inchangés.
- Capture de documents par `document_paths` : les empreintes et preuves de
  fichiers sont calculées par le service, sans demander au modèle de les inventer.
- Preuves de contrôle liées à une revue indépendante et à la livraison courante ;
  les anciennes tentatives ou preuves ne peuvent pas clore le nouvel état.
- Blocage des nouveaux lancements pendant pause/arrêt, jusqu'à la fin observée
  des processus ; refus des autorités révoquées et des générations périmées.
- Revalidation des autorités avant les effets Git et la publication des preuves.
- Conservation de la provenance des instructions requises entre worktrees et
  exclusion des schémas d'outils natifs du budget de mission.
- Livraisons Git cumulatives après reprise : le snapshot couvre toute la mission
  depuis sa base assignée, avec contrôle du scope et refus d'une base incompatible.
- Banc de charge simulé exerçant sept places réelles du scheduler, avec HTTP,
  workspaces et enfants Node POSIX ; aucune CLI LLM dans cette preuve.
- Guides d'installation locale, d'usage, de sauvegarde et d'extension des adaptateurs,
  avec exemple de mission documentaire.

Le rapport de recette livré avec le paquet qualifie la source et le paquet retenus,
les parcours natifs mixtes, la charge native observée et les limites restantes.
Les tests simulés et les preuves séparées des adaptateurs ne remplacent pas
cette recette. Les niveaux de validation sont consignés dans ce rapport.
Aucune qualification Linux/Windows ou CI distante n'est revendiquée ici.
Le paquet reste local ; aucune publication externe n'a été effectuée.
