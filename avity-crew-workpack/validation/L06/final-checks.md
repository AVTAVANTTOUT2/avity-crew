# Contrôles finaux après correction L06

Source corrigée et candidat complet : `git:355b32a61d8e64576c1a61e039c5fd48f2abfd4d`.

Exécutés dans un checkout détaché de cette révision avec `npm ci --ignore-scripts` :

- `npm run check` : réussi, types, format, build et **82/82 tests** sur Node 26.12.0, aucun skip ni annulation.
- `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` : réussi, **82/82 tests**, aucun skip ni annulation.
- Revue indépendante du correctif : les 15 tests workspace passent, les deux constats sont clos, voir `independent-review.md`.

Avant correctif : les deux nouveaux tests échouaient (livraison hors périmètre acceptée ; heartbeat du petit-fils continuant après retour du timeout). Après correctif : mêmes tests passent. Les chemins `..`, non canoniques et alias de dossier vers un autre périmètre sont refusés. L’escalade du groupe de processus survit au `close` du parent et se termine avant le retour du timeout.

Ces contrôles incluent le code Codex intégré et ses tests hors ligne. Les preuves fournisseurs live restent attribuées à leurs révisions propres ; aucun live n’a été relancé par ces contrôles.
