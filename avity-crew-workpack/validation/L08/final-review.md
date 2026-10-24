# L08 — Revue finale indépendante

Décision : **accepted**, aucun finding bloquant. Relecteur : `l00_provider_audit`. Passation : `handoff-d643c212ae3f415f9d8cf074200a2107`. Source et candidat moteur testés : `537d3c40f673eb2ca7b0984d695bfed90282e746`. Cette revue bornée vérifie la combinaison actuelle et les traces ; elle ne prétend pas remplacer les relectures indépendantes antérieures de mes propres modules transport, contexte ou CLI.

## Source et artefact

HEAD est resté sur cette source et le diff suivi est propre après les contrôles. Le tarball conservé `/Users/zeldris/.codex/avity-crew-validation/20261024/release-final/avity-crew-0.1.0.tgz` contient 130 entrées ; son SHA256 recalculé vaut `947da88b8cede34df6a50d1e3b5c0fed3db006d001c976ca35b8df20550c47d1`, identique au rapport de recette. Les octets du runtime compilé du tarball correspondent au build source courant. L'installation et le navigateur sont des preuves consignées par le coordinateur, pas de nouvelles opérations réalisées par ce relecteur.

Les deux dernières revues de récupération ont été relues : livraison cumulative `acaa22c3e71cf9f5b98c5d4edfad118aa301ccae`, puis préparation `80e39304e8cbcb29f56bde2b9c757daf01a01803`. Entre ce dernier correctif et la source537, le diff ne contient que 338 lignes de tests runtime supplémentaires, aucun changement produit. Leurs conclusions et limites restent applicables : baseline/scope cumulatifs contrôlés ; capture refusée consommant la délégation puis bloquant la tâche ; ancien contenu préservé sans promesse d'import automatique.

## Contrôles exécutés ici

Depuis `/Users/zeldris/avity-crew` :

- `npm run check` : exit0 sous Node26.12.0 ; génération, typage, formatage, build et suite réussis.
- `npm exec --yes --package=node@24.22.1 -- node --test --test-reporter=tap 'dist/tests/**/*.test.js'` : exit0, **182/182**, zéro échec, annulation ou skip.
- Commande concrète de relecture des traces, exécutée avec SQLite en lecture seule et Git :

```sh
node /Users/zeldris/avity-crew/avity-crew-workpack/validation/L11/assert-native-recipe.mjs /Users/zeldris/.codex/avity-crew-validation/20261024/data/avity-crew/project-1a121d7e95c2fc3d1965e22469d3c29b/state.sqlite '/Users/zeldris/.codex/avity-crew-validation/20261024/native new app final' run:71469044-5ca6-473e-8e78-de2f4ad719e6
```

Résultat : exit0 et `NATIVE_RECIPE_OK`. Les paramètres du handoff ont ainsi été développés et exécutés sur les chemins existants ; **une resoumission n'est pas nécessaire pour ces seuls paramètres**, puisque les références sont résolues sans ambiguïté ici.

## Critères et nature des preuves

| Critère | Preuve examinée et conclusion |
|---|---|
| AC-L08-01 — Mission exploitable | Les cinq tâches ont critères et scope ; les contextes enregistrés pour chacune ont objectif, sources, empreinte et couches team_rules/role_rules/mission/updates. Compilation et inspection couvertes par la suite actuelle. |
| AC-L08-02 — Parallélisme réel | Dans la nouvelle recette uniquement sur537, les événements natifs complets relient deux tâches développeur distinctes à Claude et Codex : chevauchement **16:11:29.749Z–16:12:39.792Z**. Pic mesuré par intervalles=3, limite=3. Le rapport OS observe séparément trois PID natifs vivants à16:26:59.754Z ; ce n'est pas le même échantillon que celui des auteurs. |
| AC-L08-03 — Boucle corrective | Suite actuelle : test runtime « changes_requested produces a recorded correction strategy, a new attempt and new observed evidence before acceptance », tests Store/amendement et scénario Git combiné. La recette native récente contient des corrections de passation/preuves, mais pas de Review changes_requested : les trois Reviews enregistrées sont approved. La preuve précise de ce critère reste déterministe, sans la présenter comme un refus de revue natif récent. |
| AC-L08-04 — Chef interchangeable | Même run natif : chef initial Claude, chef final Codex, génération2 ; aucun remplacement d'objectif. La décision ciblée v2 est approved à16:14:28.008Z et remplace la décision initiale superseded avant la reprise rapportée. Les variantes et la conservation d'autorité sont aussi testées localement. |
| AC-L08-05 — Fin justifiée | Assertions réelles : run completed/version378, cinq tâches accepted, deux acceptations sur `git:1a82bbfb58223460449bffa2ca3cf257e4f30879`, revues finales approved sur cette même révision et preuves passant les contrôles ; critères requis exactement couverts par l'unique final. Les refus MISSING_EVIDENCE/INVALID_PROVENANCE sont conservés. La réponse user_response existante sélectionne des logs déjà retenus par les bonnes acceptations ; elle ne retire aucun critère ni garde du moteur. |
| AC-L08-06 — Une seule place | Tests runtime actuels de délégation/alternance/max1 et indépendance après échec ; recette documentaire historique max1/pic complet1 en complément. Aucun pic3 de la nouvelle recette n'est utilisé comme preuve max1. |
| AC-L08-07 — Document sans Git | Tests HTTP/SQLite/coordination actuels ; preuve historique distincte `run:6eb68e3b-a22b-4920-9ab7-b4d0a10f37e6`, completed, acceptation et deux revues approved de `sha256:88402fd2d4118062b0c7893cbe617311409dab29b5d105196a0964b95428bb12`. Cette recette historique conserve ses limites de développement et ne prétend pas avoir été rejouée sur le paquet537. |

## Cohérence de la recette récente et limites

La relecture SQLite/Git indépendante retrouve **22 tours natifs complets, aucun incomplet**, deux fournisseurs, cinq tâches acceptées, deux acceptations et une clôture. Le candidat livré reste sur la ref dédiée ; HEAD initial et propreté du dossier principal sont conservés. Les deux contrôles observés du candidat (`check:git-diff`, `acceptance`) ont exit0. Le diff Git entre le candidat navigateur `9496620e15050159a3e82acb0542c1ae874f13e0` et le candidat accepté est vide pour `src/server.mjs`, `public/index.html` et `README.md` : le transfert de preuve navigateur est cohérent pour ces fichiers. Le navigateur n'a pas été relancé par ce relecteur.

Les interventions opérateur de pause, redémarrage, remplacement du chef, amendement ciblé et diagnostic de références sont explicites. Les empreintes des fichiers partiels préservés après redémarrage sont une observation rapportée ; les invariants de récupération sont également couverts par les tests actuels et les revues L10. L'ancien run49d reste un incident, pas une réussite réécrite.

Aucun nouveau fournisseur, processus natif, publication ou état de coordination n'a été lancé/modifié pendant cette revue. Qualification locale macOS arm64 ; Linux/Windows et CI distante non exécutés. La validation du lot L08 n'anticipe pas l'acceptation de L11/L12.

