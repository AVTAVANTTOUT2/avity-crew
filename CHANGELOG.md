# Changelog

## 0.1.0 — Préparation locale, recette ouverte

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

### Implémenté, en recette d'intégration

- Service HTTP local authentifié, outils MCP/CLI partageant les mêmes contrats,
  coordination persistante et chef indépendant du graphe des tâches.
- CLI asynchrone, conversation multiligne, vue détachable, choix du chef,
  questions, messages ciblés, inspection de contexte et exports.
- Contrôles de revue, versions, rejouabilité, attente utilisateur et annulation
  d'un lancement encore en préparation ; scénarios HTTP/SQLite avec providers simulés.
- Reprise explicite et contrôles d'identité des processus POSIX ; les issues
  ambiguës restent signalées au lieu d'être présentées comme un arrêt confirmé.
- Guides d'installation locale, d'usage et de sauvegarde.

Au point de référence `4c003ca` du 24 octobre 2026, L07–L12 ne sont pas acceptés.
Les suites locales à 125 puis 143 tests réussis ne remplacent pas la recette
native de bout en bout. Un premier essai intégré Claude a rencontré
`IDEMPOTENCY_CONFLICT` lors de plusieurs événements. Des essais ultérieurs ont
observé les mutations MCP `create_task`, `report_blocker` et `publish_note`, ainsi
que l'écriture d'un document sans Git. Le run reste en pause : l'entrée de
passation exige des empreintes avant leur capture, que le modèle refuse
d'inventer ; correction du contrat en cours. Aucune validation globale,
Linux/Windows ou CI distante n'est revendiquée.
Le paquet reste local ; aucune publication externe n'a été effectuée.
