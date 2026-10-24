# L06 — Preuves de la livraison

Auteur : session `/root/l00_acceptance_map`, rôle de lot `l06-workspace`.
Date : 2026-10-24. Worktree exclusif : `/Users/zeldris/.codex/worktrees/avity-crew-l06`.
Branche : `build/l06-workspace`.
Base acceptée : `git:cff8ef66ad33bf0e103e9192d868baabcd7a220d`.
Source : `git:f8b2177e0749ad577127b34f2b62bbe63a3fbe53`.

Environnement observé : Darwin 25.5.0 arm64, Node 26.12.0 ; référence Node 24.22.1 également exécutée ; Git 2.56.0. Les essais emploient de vrais dépôts Git jetables, de vrais processus Node, de vrais sockets et SQLite local. Les tests providers déjà présents restent des fixtures hors ligne ; aucune CLI Claude/Codex réelle n'a été lancée dans cette sous-tâche.

## Commandes réellement exécutées

| Commande | Résultat final |
|---|---|
| `npm ci` | exit 0 ; 29 paquets ajoutés, 35 audités ; aucune vulnérabilité signalée par npm |
| `npm run check` | exit 0 ; typage strict, Prettier, génération/build et 56 tests réussis, aucun échec/skip/annulation |
| `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` | exit 0 ; 56 tests réussis, aucun échec/skip/annulation, enfants exécutés avec ce runtime |
| `git diff --cached --check` | exit 0 avant le commit source |
| `git rev-parse HEAD` / `git status --porcelain` après commit | SHA exact ci-dessus ; checkout propre |

La suite finale comprend les 43 tests du socle courant et 13 nouveaux tests workspace/ressources. Une première compilation a identifié une fixture `Criterion[]` au lieu du tuple non vide requis ; la fixture a été construite avec son critère explicite. Une première exécution comptait 53/54 réussis et un échec de comparaison `/var` / `/private/var` dans le test documentaire ; l'assertion compare désormais à la racine canonique du projet, sans changer le comportement ni retirer le contrôle. Les contrôles finaux ci-dessus ont été réexécutés sur les fichiers du commit source.

## Couverture comportementale

- **AC-L06-01 :** deux branches/worktrees distincts depuis la base explicite ; les modifications et le fichier non suivi du dossier utilisateur restent identiques, HEAD utilisateur reste sur sa base.
- **AC-L06-02 :** deux sockets réellement ouverts sur des ports distincts ; une tentative de bind sur un port tenu échoue ; deux chemins SQLite distincts créent chacun leur table ; réservation nommée exclusive et release idempotent ; ports/dossier enregistrés dans le Workspace.
- **AC-L06-03 :** deux livraisons compatibles réunies ; preuves avec SHA exact du candidat ; ref cible absente créée depuis la base ; aucune promotion avant contrôle ; deux sources valides isolément échouent une fois combinées et ne font pas avancer la cible ; branche avancée extérieurement et cible checkoutée refusées.
- **AC-L06-04 :** changements conflictuels du même fichier ; les commits sources restent accessibles et le candidat conserve index/fichier conflictuel et chemins nécessaires à une mission de résolution.
- **AC-L06-05 :** dépôt sale préservé ; snapshot indépendant des modifications ultérieures ; périmètre persistant respecté ; nettoyage refusé tant que le worker n'est pas observé arrêté, ou si du travail ultérieur/non suivi/ignoré demeure ; refus de supprimer un dossier documentaire ; baseline vide explicitement autorisé sans commit des fichiers utilisateur.
- **AC-L06-06 :** préparations identiques mises en file restituant le même résultat ; promotion et nettoyage rejoués sans double effet ; Store fermé/rouvert entre effet Git et constat SQLite ; writer tué par SIGKILL pendant le contrôle du candidat, travail conservé et replay bloqué par une demande de réconciliation.

Le test SIGKILL tue uniquement le writer enfant de fixture et le groupe du processus de contrôle créé pour ce test. Le PID reçu est validé et distingué du PID du test/du writer avant signal. Le candidat et ses sources sont vérifiés ensuite ; aucun daemon ou provider partagé n'est utilisé.

## Limites explicites

La promotion met à jour une ref de livraison non checkoutée ; elle n'annonce pas avoir appliqué les fichiers dans le dossier principal. L07 place sa revue/acceptation entre préparation et promotion. Le contrôle de reprise est unique lorsqu'il récupère un verrou d'un service mort ; les autres commandes Git externes doivent être coordonnées. Les dossiers de candidats sont conservés pour inspection, avec procédure de retrait explicite dans `docs/WORKSPACE.md`.

Linux/WSL, CI distante et orchestration produit complète : NON EXÉCUTÉ dans cette livraison. Les tests macOS ne sont pas une garantie générale multi-OS. Aucun manifeste, export partagé, lockfile, contrat ni changelog n'a été modifié ; leur intégration reste centralisée selon la mission. Aucune publication, aucun push ni déploiement effectué.
