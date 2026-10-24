# L01 — Candidat corrigé

Source/candidat : `git:82761cd3f7b94ad00320a01541c38024256b8269`.
Base : `git:e42d658c2e2cf55bc70973e4f6b893d3b61850ba`.

`npm run check` : exit 0, typage et format réussis, 11/11 tests hors ligne sur
Node 26.12.0. `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` :
exit 0, 11/11. `git diff --cached --check` : exit 0.

Correction du refus de revue : `FakeProvider.send` lève UNSUPPORTED ; la garde
de tentative compare à l'état actuel de tâche ; le résultat de simulation suit
la fin ou l'interruption effective du flux. Régressions couvrant une interruption
après premier événement, une tentative précédente cohérente avec elle-même,
un producteur étranger et une tentative inactive.

Autres corrections retenues de la revue Claude : garde de fin de run et preuve
live, typage de validation lié au schéma, refus de sous-pointeur inconnu, Ajv
strict, configuration générée depuis son schéma, schémas/fixtures autonomes dans
le produit. Les copies de schémas gardent les mêmes champs que le workpack.

La revue Claude est statique et vise le candidat précédent ; le présent candidat
doit être vérifié par le reviewer natif. CI distante et recette produit restent
non exécutées ; aucun accès distant ni secret fournisseur utilisé dans ces tests.
