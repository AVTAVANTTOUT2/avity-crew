# Revue finale indépendante L09

Relecteur : `/root/l05_codex`. Passation examinée : **`handoff-3f1bfc4b6ca44bd385870d84b9ae7287`**, `validation/L09/final-handoff.json`. Source et candidat testés : **`git:537d3c40f673eb2ca7b0984d695bfed90282e746`**. Conclusion : **accepted**, aucun finding restant dans le périmètre L09. Ce rapport ne change aucun statut de coordination et ne prononce pas l'acceptation des autres lots.

## Delta et commandes exécutées

La première revue indépendante `independent-cli-review.md` sur `ccbab6f1551c2f54056bece878b229377f1ef52f` a été relue. La comparaison Git confirme que `apps/cli/src`, `tests/fixtures/cli` et `docs/CLI.md` sont inchangés. Le seul delta du test CLI ajoute une observation du stdout et attend le premier snapshot `ok:true` avant de déconnecter le serveur. Les assertions de reconnexion, absence de nouveau run/stop/shutdown, identité du run et absence de doublon restent identiques. L'échec intermédiaire et les six répétitions sont conservés dans les preuves de livraison ; ils ne sont pas rebaptisés en succès.

Contrôle indépendant exécuté sur le candidat : `node --test dist/tests/cli.test.js`, Node **26.12.0**, **11/11 réussis, zéro skip**, exit **0**. Les trois parcours PTY ont réellement tourné : wizard multiligne, saisie Unicode pendant événements/redimensionnement puis `q`, et Ctrl+C. Les autres tests couvrent commandes JSON, question liée, message queued, inspection, curseur/reconnexion, codes de sortie, cwd distinct et service détaché. Leurs frontières HTTP/SQLite/PTY sont réelles ; leurs callbacks métier sont simulés.

Le tarball final référencé a été relu : SHA256 **`947da88b8cede34df6a50d1e3b5c0fed3db006d001c976ca35b8df20550c47d1`**, **130 fichiers**. Les quatre modules CLI compilés (`args`, `main`, `service`, `view`) extraits avec `tar -xOf` sont identiques octet par octet aux modules `dist` du candidat testé. Cela relie la recette installée à cette CLI, sans prétendre reconstruire ou réinstaller le paquet pendant la revue.

## Preuve native rapprochée de L09

`validation/L11/new-app-native-report.json`, `new-app-browser-qa.json`, `native-process-observation.json`, `final-checks.md` et `validation/L12/package-installation.json` ont été examinés. Leur source moteur et empreinte de paquet concordent avec celles ci-dessus. La recette utilisateur a été conduite par la racine ; aucun nouveau tour LLM n'a été lancé par ce relecteur.

Le script `assert-native-recipe.mjs` a été lu puis réexécuté contre la base SQLite **en lecture seule** et le projet indiqué par la passation. Exit **0**, marqueur `NATIVE_RECIPE_OK` : run **`run:71469044-5ca6-473e-8e78-de2f4ad719e6`**, état **completed**, version **378**, chef final **Codex**, génération **2**, **5 tâches acceptées**, **2 acceptations**, providers **Claude et Codex**, pic d'intervalles **3**, aucun tour incomplet, HEAD initial conservé et racine propre. Les preuves et revues utilisées portent sur le candidat applicatif accepté, distinct de la révision du moteur.

Une lecture ciblée de cette même base confirme **une question answered liée à son response_id**, un enregistrement `user_response`, six messages, un événement `chief.replaced` et deux snapshots de reprise. Le rapport associe ces états aux commandes opérateur : pause, arrêt/redémarrage observé du service, remplacement du chef, mise à jour du contrat avant reprise et réponse à la question finale. La preuve navigateur corrobore le comportement de l'application livrée ; elle n'est pas présentée comme un test supplémentaire de la TUI.

Ces éléments complètent la première revue pour AC-L09-01/02/03/04 : projet correctement reconnu, vrai parcours installé, états d'attente/reprise et fin durable justifiée, contexte et preuves consultables. Les tests CLI/PTY couvrent AC-L09-05/06, sans transformer une requête acceptée en succès métier. Aucun défaut d'identité, routage, détachement, reconnexion ou résultat trompeur n'a été établi.

## Limites conservées

Qualification locale **macOS arm64**. Les 182 tests globaux Node 24/26 et la recette native sont des preuves de livraison relues ; cette revue a rejoué les 11 tests CLI sous Node 26 et l'assertion de l'état natif conservé, pas toute la suite ni les sessions modèles. Les émulateurs de terminal non testés, Linux/WSL et CI distante restent hors qualification. Le détachement pendant une requête reste soumis à son échéance HTTP bornée. La charge de sept places demeure une preuve simulée séparée du pic natif observé de trois. Ces limites ne laissent pas de critère L09 requis non satisfait dans le périmètre de recette retenu.
