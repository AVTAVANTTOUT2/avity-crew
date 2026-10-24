# L02 — Preuves du candidat

Source/candidat : `git:f5f50bd0415793b5b1656b9b5816fcb7764e7f0c`.
Base : `git:4767e10e03806309bc629d4dc1e65cedc0604f0a`.
macOS arm64, Node 26.12.0 et référence Node 24.22.1.

- `npm install` : exit 0, un workspace ajouté, lockfile actualisé ; aucune
  nouvelle dépendance de production, SQLite vient du runtime.
- `npm run check` : exit 0, typage/format/build et 25/25 tests (12 contrats,
  13 stockage sur SQLite réel).
- `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` :
  exit 0, 25/25, y compris processus enfants lancés avec ce runtime.
- `git diff --cached --check` : exit 0 avant le commit candidat.

Preuves comportementales : deux enfants synchronisés sur barrière, un seul
claim réussi ; rejeu sans nouvel événement ; ancienne génération refusée après
arrêt observé/réattribution ; trigger SQLite qui fait échouer l'événement et
annule tâche/version/clé ; migration depuis version 1 et refus version 99 sans
réinitialisation ; transaction de migration tuée par SIGKILL puis rouverture ;
intention d'effet externe restée incertaine ; 141 événements lus par pages ;
sauvegarde SQLite/artefacts rouverte ; liens symboliques et namespace isolés ;
provenance de décisions remplacées, message failed et expurgation de fixture.

Le test d'ouverture concurrente d'une base neuve a échoué avant retrait de la
conversion de journal au démarrage (`database is locked` dans PRAGMA WAL). Le
mode SQLite par défaut suffit au writer unique et évite cette mutation globale.
Le test passe ensuite sur les deux runtimes. Une autre première exécution avait
une fixture handoff `partial` alors que le test attendait in_review ; la fixture
du test de livraison complète a été explicitement marquée delivered.

Les cas sont des intégrations locales déterministes, sans provider réel.
Les API ne sont pas exposées comme RPC : Actor sera dérivé du canal L07 ;
revue/acceptation de candidat et réconciliation de processus sont raccordées
dans leurs lots. Les tests ne constituent ni CI distante ni recette produit.
