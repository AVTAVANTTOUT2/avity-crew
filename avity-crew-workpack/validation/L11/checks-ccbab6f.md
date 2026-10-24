# Candidat de recette installé

Révision : `ccbab6f1551c2f54056bece878b229377f1ef52f`. macOS arm64, Node26.12.0/npm11.20.0 ; référence Node24.22.1.

`npm run check` : génération des contrats, typage strict, Prettier, build et **177/177 tests**, zéro skip, réussis.

`npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` : **177/177**, zéro skip, réussis. Les deux commandes ont aussi été rejouées indépendamment par l00_provider_audit au même SHA.

Les recettes automatisées comprennent une vraie base SQLite, des worktrees et références Git, HTTP/MCP et des subprocess POSIX. Les providers d’orchestration y sont simulés. Le test de charge à sept places a été inclus dans ces deux exécutions finales : les sept processus de laboratoire sont des processus Node, aucun CLI LLM. Le rapport b6cbf2a antérieur reste identifié à sa source et n’est pas réétiqueté.

La boucle de correction relie les modules réels de runtime/workspace : deux livraisons passent leurs contrôles isolés ; leur combinaison dépasse volontairement la capacité1 et échoue ; le run ne peut pas finir ; une mission corrective conserve les deux modules et sérialise leur exécution ; le nouveau candidat est contrôlé, relu, accepté et seulement alors terminé. La branche initiale et les critères restent préservés.

Les régressions de contexte ont été démontrées rouges avant leurs correctifs : schéma d’outil natif indûment recopié dans la mission obligatoire ; instruction requise AGENTS dont la provenance était perdue entre worktrees. Les vérifications incluent deux vrais worktrees avec espaces, le même contenu épinglé, un contenu modifié signalé et une exclusion de source requise refusée.

Les régressions d’autorité ont été démontrées rouges puis vertes : requête en queue après révocation, préparation de candidat après révocation, promotion Git après révocation. Les tests positifs review/finish conservent leur comportement.

L’installation a été réalisée depuis le tarball local SHA256 `5bafe43252c360d584c72a6b8cc6fe9e5734b73f128047a96381e47afe1acf3a`, pas depuis le binaire de développement. Les preuves natives sont référencées séparément. Linux/WSL et CI distante : NON EXÉCUTÉS.
