# L02 — Candidat corrigé intégré

Source/candidat : `git:ea8ac7a9c6d23d077f9239d12ad634b564e05856`.
Base de cette correction : `git:b30b3301a826513ed706d248962df1baf44e8354`.
La combinaison contient aussi L04 intégré ; cela ne remplace pas sa recette live.

Quatre régressions ont été exécutées avant correctif avec `npm test` : exit 1,
38 réussis et 4 échecs. Cibles : corrélation des événements, corruption d'un
artefact déjà présent, racine Git depuis src et conservation d'identité lors
de l'initialisation Git d'un dossier neuf.

Après correction : `npm run check`, exit 0, typage/format/build et 42/42 tests
sur Node 26.12.0 ; `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'`,
exit 0, 42/42. `git diff --cached --check` : exit 0 avant le commit source.

Les événements gardent actor_id séparé des identifiants cibles et sont validés
avant écriture. Un artefact existant est relu/vérifié, jamais réputé valide par
son nom seul. root provient de Git --show-toplevel ; l'identité standard issue
du parent du répertoire commun .git reste stable lors d'un git init et partagée
entre worktrees. Les espaces significatifs des chemins ne sont pas supprimés.

Le rapport initial, les preuves SQLite et le refus indépendant restent conservés.
La revue finale indépendante de cette nouvelle combinaison reste à enregistrer.
