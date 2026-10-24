# Candidat installé b0571ad

Source : `b0571ad56aa5a63768537fbfe4bdcd9639c2954e`. macOS arm64, Node26.12.0/npm11.20.0 ; référence Node24.22.1.

- `npm run check` : génération des contrats, typage strict, Prettier, build et **181/181 tests**, zéro skip, réussis.
- `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` : **181/181**, zéro skip, réussis.
- Le test de charge annonce sur chaque version : sept places configurées, sept processus Node observés, sept places Scheduler, sept workspaces ; zéro CLI LLM. État final paused, aucun succès métier inventé.
- Quatre régressions Git de reprise étaient rouges avant acaa22c puis vertes : snapshot cumulatif, scope cumulé, exclusion cumulée, base amendée incompatible. Validation indépendante 4/4 Node24/26 et probe indépendant 19/19 workspace Node26. Le candidat contient les fichiers des deux tentatives, la promotion préserve la branche et le travail utilisateur.
- Stabilisation du fixture de reconnexion : attente du premier snapshot connecté avant coupure, mêmes assertions de perte/reconnexion/cursor et même timeout. Six répétitions ciblées réussies ; suites finales ci-dessus réussies. Un contrôle intermédiaire avait échoué avec actual1/expected4 ; l’extrait retenu ne permet pas de lui attribuer avec certitude un test. Il n’est pas compté comme réussite.

Les recettes simulées conservent SQLite, Git, HTTP/MCP et processus réels aux frontières. Elles ne revendiquent aucun CLI natif. La boucle isolé→combinaison échouée→mission corrective→nouveau candidat testé/revu/accepté demeure incluse.

Tarball installé : SHA256 `f51a3216c854c0015ac8eff984e3d9f9e976aa2f9de98d8f470198cc1308730c`, 130 fichiers. Les refus MCP réels des deux providers ont été rejoués sur ce paquet et figurent dans native-permissions.json. Les recettes applicatives et leurs révisions sont rapportées séparément.

Linux/WSL et CI distante : NON EXÉCUTÉS.
