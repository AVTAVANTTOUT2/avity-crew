# L06 — Passation workspace et intégration

Responsable de livraison : `l06-workspace`, session réelle `/root/l00_acceptance_map`.
Branche/worktree : `build/l06-workspace`, `/Users/zeldris/.codex/worktrees/avity-crew-l06`.
Base : `cff8ef66ad33bf0e103e9192d868baabcd7a220d`.
Commit à intégrer : `f8b2177e0749ad577127b34f2b62bbe63a3fbe53`.

## Livré

- `packages/workspace/src/index.ts` : manager via Store public, opérations persistées, worktrees, snapshots immuables et scope, candidat/proofs, promotion CAS distincte, nettoyage conservateur et réconciliation.
- `packages/workspace/src/git.ts` : exécution argv sans shell, inspections Git/chemins NUL, limites et arrêt borné des commandes.
- `packages/workspace/src/resources.ts` : ports réellement tenus, dossiers et chemins SQLite distincts, réservations nommées, libération idempotente sans effacer les fichiers.
- `tests/workspace.test.ts` et fixture `workspace-worker.ts` : 13 scénarios Git/processus/ressources réels.
- `docs/WORKSPACE.md` : API L07, décisions, reprise, conservation et procédures.

Les imports restent relatifs, conformément au socle ; aucun contrat, manifeste, export, lockfile ou changelog partagé n'a été changé. Le coordinateur conserve l'intégration et la revue indépendante ; cette passation n'accepte pas sa propre livraison.

## Points utiles à L07

Construire `WorkspaceManager(store, serviceActor)` avec un Actor interne de rôle `user`. Réserver les ressources, les passer à `createWorkspace`, collecter avec le périmètre de mission, préparer le candidat et faire vérifier/revoir son SHA. Appeler `promoteIntegration` seulement après les règles d'acceptation du service. La cible doit être une branche de livraison dédiée non checkoutée, ou une ref sous `refs/avity-crew/` ; ne pas annoncer que HEAD/fichiers utilisateur ont été avancés.

Les codes `conflict`, `validation_failed`, `TARGET_ADVANCED`, `RECONCILIATION_REQUIRED`, `UNPRESERVED_CHANGES`, `ACTIVE_WORKSPACE` et `TARGET_CHECKED_OUT` expriment des situations réelles, avec travail conservé. Le conflit expose dossier, base et IDs de livraisons pour créer la mission de résolution. Une préparation partielle inconnue n'est jamais effacée pour recommencer.

Libérer les ports juste avant la reprise par l'application puis observer son bind ; le lease ne promet plus l'exclusivité après release. Conserver les bases temporaires tant que leurs résultats restent utiles. Observer l'arrêt du worker avant nettoyage. Les sources sont conservées par des refs Git ; la sauvegarde SQLite ne remplace pas celle du dépôt.

## Preuves

Voir `checks.md` : `npm ci`, `npm run check` et 56/56 tests sur Node 26 ; 56/56 également sur Node 24.22.1 ; diff-check réussi et checkout propre. Scénarios : séparation, combinaison exacte, conflit, test combiné échoué, avance externe, dirty root, documents sans Git, init explicite, opérations rejouées, reprise Store, cleanup interrompu et SIGKILL du writer.

NON EXÉCUTÉ : CI distante, Linux/WSL et essai de l'orchestration produit. Aucun provider réel lancé. La revue et l'intégration par le coordinateur sont des étapes normales de livraison, pas une fonctionnalité laissée inachevée par L06.
