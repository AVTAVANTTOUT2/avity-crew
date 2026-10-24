# L02 — Revue finale du stockage

Relecteur : session indépendante `l00_acceptance_map`, 2026-10-24.
Checkout exclusif : `/Users/zeldris/.codex/worktrees/avity-crew-l02-review`.
Handoff : `handoff-1071db1c21fb4d49ad55ae3fb40e490e`.
Base de correction : `git:ea8ac7a9c6d23d077f9239d12ad634b564e05856`.
Source et candidat combiné : `git:cff8ef66ad33bf0e103e9192d868baabcd7a220d`.

What this change does: it completes the persistent SQLite foundation and fixes the project descriptor returned after Git is initialized. Reopening refreshes detected root/Git paths while retaining durable preferences, history and work.

Looks good. Ship L02. Aucun finding restant dans le périmètre de ce lot.

## Correction finale vérifiée

Le diff ciblé du constructeur garde la vérification d'identité et la transaction existantes, construit le descripteur courant depuis le JSON persistant en rafraîchissant uniquement `root`, `git_common_dir` et `data_dir`, puis le réenregistre. Il conserve donc `config`, `map_version` et `created_at` au lieu de les remplacer par les valeurs par défaut de la nouvelle détection.

La nouvelle régression ouvre Store avant `git init`, persiste un run ainsi que des préférences et métadonnées distinctes, initialise Git puis rouvre la même identité. Elle vérifie les chemins détectés actuels, la date initiale, `map_version`, la capacité configurée et le run conservé. Elle passe dans la suite finale exécutée par le relecteur. L'échec préalable 42/43 est attesté séparément par le coordinateur dans `checks-3.md` ; il n'est pas présenté comme une commande exécutée par le relecteur.

Les trois corrections précédemment revues restent dans la combinaison finale et leurs tests passent : auteur distinct de la cible des événements, artefact existant vérifié avant succès et vraie racine Git depuis un sous-dossier avec identité stable. Les deux refus précédents restent conservés dans `review.md/json` et `review-2.md/json`.

## Contrôles indépendants réellement exécutés

Plateforme : macOS arm64. Runtime installé : Node 26.12.0 ; référence également exécutée : Node 24.22.1.

| Commande / contrôle | Résultat observé |
|---|---|
| `npm ci` | exit 0 ; 29 packages ajoutés, 35 audités ; aucun signalement npm de vulnérabilité |
| `npm run check` | exit 0 ; typage strict, format, génération/build ; 43 tests réussis, aucun échec/skip/annulation |
| `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` | exit 0 ; 43 tests réussis sur Node 24.22.1 |
| `git diff --check ea8ac7a9c6d23d077f9239d12ad634b564e05856 cff8ef66ad33bf0e103e9192d868baabcd7a220d` | exit 0 |
| `git rev-parse HEAD` et `git status --porcelain` avant/après | SHA exact candidat ; checkout propre |
| Vérification du handoff courant par son identifiant exact | `handoff-1071db1c21fb4d49ad55ae3fb40e490e` vise bien le candidat `cff8ef66ad33bf0e103e9192d868baabcd7a220d` |

## Couverture L02

- AC-L02-01 : SQLite sur fichier, deux processus indépendants et une barrière ; un seul claim actif. Ouvertures concurrentes d'une base neuve vérifiées.
- AC-L02-02 : rejeu conserve identité et compte d'événements ; mutation, événement et résultat idempotent restent transactionnels. Rollback effectif sur échec de l'événement.
- AC-L02-03 : garde de tentative courante dans la transaction, réattribution explicite après arrêt observé, ancienne génération refusée ; expiration du heartbeat sans libération silencieuse.
- AC-L02-04 : réouverture, transaction tuée par SIGKILL, intentions d'effets externes conservées sans faux succès ; sauvegarde SQLite/artefacts rouverte et journal paginé.
- AC-L02-05 : migration depuis la version précédente conservant les données et refus des versions futures sans réinitialisation ; transaction interrompue réouverte sans état partiel.
- AC-L02-06 : décisions et remplacement sourcés, états des messages dont échec explicite, journal corrélé aux cibles, artefacts vérifiés, séparation de projets et vues expurgées. La métadonnée projet actualisée conserve les décisions et le travail.

La suite combinée contient les contrats, les 18 tests de stockage réel SQLite et les 13 tests de providers L04 sur fixtures/processus de test. Ces derniers ne constituent pas des essais de la CLI Claude réelle. Aucun provider réel, code produit ou registre externe n'a été lancé/modifié par le relecteur ; seule l'acceptation de chantier ci-jointe est enregistrée via l'utilitaire canonique.

Verdict: Ship L02.

Not checked: CI distante, RPC authentifié, orchestration/acceptation complète des livraisons, workspaces Git, interface utilisateur et paquet final restent aux lots suivants. Aucune preuve live fournisseur ni portabilité Linux/WSL n'est déduite de cette revue locale.
