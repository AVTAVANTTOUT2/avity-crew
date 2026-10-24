# Candidat installé 537d3c4

Source : `537d3c40f673eb2ca7b0984d695bfed90282e746`. macOS arm64, Node26.12.0/npm11.20.0 ; référence Node24.22.1.

- `npm run check` : génération, typage strict, Prettier, build et **182/182 tests**, zéro skip, réussis.
- `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` : **182/182**, zéro skip, réussis.
- Chaque suite annonce sept places configurées, sept processus Node observés, sept places Scheduler, sept workspaces, zéro CLI LLM. État final paused, aucun succès métier inventé.
- La boucle de correction vérifie l'échec de la combinaison puis une correction qui conserve les fonctionnalités, un nouveau candidat contrôlé, des revues et la clôture justifiée.
- Quatre régressions réelles Git vérifient la collecte cumulative des tentatives, le scope, l'exclusion et le refus d'une nouvelle base incompatible. Elles étaient rouges avant acaa22c ; tests indépendants Node24/26 et revue Git/Store distincte ensuite verts.
- Une régression de préparation était rouge avant80e3930 : une capture de reprise qui échoue laissait la délégation queued et provoquait des relances. Le correctif consomme la délégation avant l'await et trace une tentative de préparation exited sans PID, la tâche blocked et une seule erreur malgré cinq réveils ; la mission indépendante continue. Une nouvelle délégation explicite peut relancer. Le contenu dont la capture est incertaine n'est pas prétendu réconcilié automatiquement.
- La fixture de reconnexion attend désormais un premier snapshot connecté avant de couper le serveur, avec les mêmes assertions et timeout. Six répétitions ciblées puis les suites complètes ont réussi. L'échec intermédiaire1/4 conservé dans checks-b0571ad.md n'est pas compté comme réussite.

Tarball installé : `947da88b8cede34df6a50d1e3b5c0fed3db006d001c976ca35b8df20550c47d1`, 130 fichiers. Les refus MCP natifs des deux providers sont rejoués sur ce paquet dans native-permissions.json. Les recettes applicatives et leurs révisions sont rapportées séparément.

Les tests automatisés utilisent des providers simulés mais SQLite, Git, HTTP/MCP et processus réels aux frontières. Linux/WSL et CI distante : NON EXÉCUTÉS.
