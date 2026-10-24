# Vérification de combinaison L05/L06

Révision testée : `git:0aede89d57113e9a08b77af69b542291ca592e6b`.

Les commits propres Codex jusqu’à `7fb39c6` sont intégrés par cherry-pick ; les changements partagés du runner restent les originaux `b24a2ce` et `d229058`. Les fichiers produit Codex, fixtures et recette ont été conservés. Le package exporte maintenant `CodexProvider` avec `ClaudeProvider`. L06 est fusionné et exporté.

- `npm run check` : réussi, types, Prettier, génération/build et 80/80 tests Node 26.12.0 ; aucun échec, skip ou annulation.
- `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` : réussi, 80/80 tests ; aucun échec, skip ou annulation.
- Les deux commandes ont été exécutées sur cette révision, le 24 octobre 2026. Aucun fournisseur live relancé par cette vérification de combinaison ; les neuf tours L05 restent attribués à leur source exacte `7fb39c6`.

Revue source indépendante du coordinateur : argv et stdin sans shell, modèle nul conservant le choix natif, inventaire MCP borné et rafraîchi, protections natives conservées, espace crew sans collision, aucune valeur d’environnement en argv, reprises UUID exactes. Seuls les deux préfixes natifs d’avertissement observés sont non fatals ; résultat natif et sortie 0 restent requis. Les erreurs de premier niveau, refus MCP et autres items d’erreur restent fatals. Les limites hors critères restent dans `native-report.md` et `docs/providers/codex.md`.
