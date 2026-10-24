# L02 — Actualisation de la détection

Source/candidat `git:cff8ef66ad33bf0e103e9192d868baabcd7a220d`.
Base `git:ea8ac7a9c6d23d077f9239d12ad634b564e05856`.

La nouvelle régression ouvre le Store avant git init, conserve un run et des
préférences, initialise Git puis rouvre la même identité. Avant correction :
`npm test` exit 1, 42 réussis/1 échec, git_common_dir encore null. Après correction :
`npm run check` exit 0, 43/43 et typage/format/build ; les 43 tests Node24.22.1
réussissent également. `git diff --cached --check` exit 0.

La transaction de démarrage rafraîchit root/git_common_dir/data_dir depuis la
détection courante, en conservant config, map_version et created_at persistés.
Le test vérifie également que le run demeure accessible. Les autres corrections
de la revue et leurs régressions restent inchangées et vertes.
