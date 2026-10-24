# L01 — Revue finale du socle

Relecteur : session `l00_acceptance_map`, indépendante de l'auteur du code.
Date : 2026-10-24. Checkout réservé : `/Users/zeldris/.codex/worktrees/avity-crew-l01-review`.
Handoff : `handoff-ea347f077296404c896271ca4ac08b35`.
Base : `git:e42d658c2e2cf55bc70973e4f6b893d3b61850ba`.
Source et candidat combiné : `git:4767e10e03806309bc629d4dc1e65cedc0604f0a`.

What this change does: it delivers the TypeScript foundation, schema-based contracts and validation, task/run guards, a deterministic simulated provider, an honest initial CLI, and offline CI commands. The final correction makes a simulated error without details remain an explicit protocol failure.

Looks good. Ship L01. Aucun finding restant dans le périmètre du socle.

## Résultat de la revue

Le diff final depuis `82761cd3f7b94ad00320a01541c38024256b8269` ne modifie que la branche d'erreur ciblée du fake, son test et les preuves documentaires conservées. Les manifests et le lockfile sont inchangés depuis l'installation indépendante `npm ci` du candidat précédent, qui avait réussi sur le même checkout. Les deux refus antérieurs et leurs motifs restent conservés dans `review.md/json` et `review-2.md/json`.

L'événement `error` sans payload produit maintenant une erreur `protocol` explicite ; il ne peut plus être effacé par un événement de résultat réussi. Le test ajouté couvre exactement la reproduction du second refus et passe dans la suite finale. Le coordinateur rapporte son échec avant correction dans `checks-3.md` ; le relecteur a réexécuté le test et la suite après correction, sans prétendre avoir exécuté lui-même l'étape avant correction.

Les corrections précédemment revues restent présentes et vérifiées par les tests finaux : refus explicite de `send`, comparaison avec le `TaskState` actuel, rejet des propriétaires périmés/producteurs étrangers/tentatives inactives, interruption après le premier événement, validation liée au nom du schéma, rejets négatifs, provenance simulée et gardes de clôture. Schémas et fixtures appartiennent au produit, sans appel à l'utilitaire du chantier.

## Contrôles finaux réellement exécutés

Plateforme du relecteur : macOS arm64 ; Node installé 26.12.0 ; Node de référence testé 24.22.1.

| Commande / contrôle | Résultat |
|---|---|
| `git rev-parse HEAD` | SHA exact `4767e10e03806309bc629d4dc1e65cedc0604f0a` |
| `git status --porcelain` / `git status --short` avant et après | Checkout propre ; seuls les fichiers générés ignorés existent en plus |
| `npm run check` | exit 0 ; typage strict, Prettier, génération/build ; 12 tests réussis, aucun échec/skip/annulation |
| `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` | exit 0 ; les 12 tests réussissent également sur Node 24.22.1 |
| `node bin/avity-crew.mjs --help` | exit 0 ; annonce explicite que l'orchestration produit reste à implémenter |
| `git diff --check e42d658c2e2cf55bc70973e4f6b893d3b61850ba 4767e10e03806309bc629d4dc1e65cedc0604f0a` | exit 0 |
| Statut du registre canonique L01 | `in_review`, handoff courant et source identiques aux références ci-dessus avant acceptation |

## Critères L01

- AC-L01-01 : installation propre depuis lockfile vérifiée indépendamment sur le même ensemble de dépendances ; typage et construction du candidat final réussis ; tests finaux Node 24/26 réussis.
- AC-L01-02 : contrats partagés utilisés par core/providers/tests sans types natifs Claude/Codex dans le domaine ; missions, tentatives et livraisons liées par identifiants explicites.
- AC-L01-03 : invalides et sous-pointeurs inconnus refusés ; opérations fake non supportées refusées ; transitions directes vers l'acceptation et tentatives périmées rejetées. Les opérations présentes sont pures et n'écrivent pas d'état partiel.
- AC-L01-04 : 12 tests hors ligne ; événements et résultats du fake restent simulés, et une simulation ne satisfait pas une preuve live.
- AC-L01-05 : workflow sans compte fournisseur, utilisant lockfile/check/pack ; les contrôles locaux correspondants passent. Le workflow distant lui-même n'a pas été exécuté, faute de dépôt distant configuré.

Verdict: Ship L01.

Not checked: aucune intégration réelle fournisseur, persistance, orchestration, installation finale ou portabilité Linux/WSL n'est validée par ce lot. La CI distante reste non exécutée ; les preuves live et la livraison installable appartiennent aux lots suivants.
