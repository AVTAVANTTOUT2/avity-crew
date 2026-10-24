# L01 — Vérifications du coordinateur

Source et candidat : `git:78ffc5bafd7c593cb779961a7ba86e23feb55398`.
Base : `git:e42d658` (SHA complet vérifiable avec Git ; la revue enregistrera le SHA complet).
Plateforme locale : macOS arm64, Node 26.12.0 et Node 24.22.1.

Commandes exécutées dans la racine produit :

- `npm install` : exit 0, lockfile créé, audit npm 0 vulnérabilité signalée.
- `npm run check` : exit 0 ; typage strict, Prettier et sept tests hors ligne.
- `npm exec --yes --package=node@24.22.1 -- node node_modules/typescript/bin/tsc` : exit 0.
- `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` : exit 0, 7/7.
- `npm exec --yes --package=node@24.22.1 -- node bin/avity-crew.mjs --help` : exit 0,
  annonce explicite du socle sans prétendre que l'orchestration est disponible.
- `git diff --cached --check` : exit 0 avant le commit source.

Les tests couvrent exemples du schéma, identifiant/version/champ invalides,
transition directe running→accepted interdite, tentative étrangère ou périmée,
cycle/dépendance absente, provenance simulée et interruption du faux provider.
Les deux modules contrats/core échangent les types de livraison et tentative.

Une première compilation a révélé la nécessité de types Node explicites avec
TypeScript 6 et l'export CJS du plugin ajv-formats. Ces erreurs ont été corrigées
avant les commandes réussies ci-dessus. Aucun contrôle n'a été affaibli.

La CI distante n'a pas été exécutée : aucun dépôt distant ni publication n'est
configuré. Le workflow est présent, sans compte fournisseur. Aucun test live
produit n'est requis par L01 ; les sept tests sont des simulations/contrats.
La revue indépendante doit encore vérifier un checkout propre avec `npm ci`.
