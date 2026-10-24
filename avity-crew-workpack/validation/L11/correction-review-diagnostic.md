# Diagnostic ciblé STALE_REVIEW — recette corrective

Source moteur : `537d3c40f673eb2ca7b0984d695bfed90282e746`. Run : `run:e8fb4f37-7e29-4112-90c3-4e70fd4daf1d`. Lecture seule de la DB `/Users/zeldris/.codex/avity-crew-validation/20261024/data/avity-crew/project-222b1ea7f3f11a39a579b09ef73a369f/state.sqlite`. Aucun appel métier, fournisseur, changement de source ou de base.

**Conclusion : le prédicat refusé est l'état des tâches productrices, pas la fraîcheur de version ni leurs révisions source.** A et B sont `blocked`. `submitReview()` exige une cible `in_review` ou `validating` (`packages/storage/src/index.ts:1862–1874`). Les premières revues négatives les ont déplacées en `blocked`, conformément aux lignes 1986–1989. Les nouvelles missions de revue ont conservé les bons handoffs et sources, mais n'ont pas réouvert les tâches productrices par une nouvelle tentative/passation.

| Champ | Auteur A | Auteur B |
|---|---|---|
| Tâche cible | `task-a-enable` | `task-b-enable` |
| État observé | `blocked` | `blocked` |
| Handoff courant | `handoff-task-a-enable-gen4-4d1df1dd` | `handoff-b-enable-gen4-20261024` |
| `source_revision` attendue pour ces handoffs | `git:fc361f30d3d58699e6c3510224780447da27c3bb` | `git:82f300da024f8da4eb8d64b080ff1dd0dad5edee` |
| Tentative active = tentative du handoff | `attempt:4d1df1dd-e15a-4144-846f-203a6a8decac` | `attempt:247eddd9-a282-4365-98c6-3cfce89098aa` |
| Génération cible = génération du handoff | `4 = 4` | `4 = 4` |
| État de la tentative productrice | `exited` | `exited` |

Le candidat combiné `git:c1990dee28d62a8877f6e55c9b50461d85b110fb` est la `tested_revision`, avec `verification_scope: combined_code`. Il ne remplace pas la `source_revision` de chaque auteur. Les identités de handoff, tentatives actives et générations concordent : le dernier terme du garde, `!['in_review', 'validating'].includes(target.status)`, suffit à expliquer le refus. Une version de run fraîche franchit le contrôle de concurrence sans rendre ce prédicat vrai.

Chronologie enregistrée : `review-b-final-20261024-gen1`, outcome `blocked`, à17:39:14Z ; `review-a-final-360ce8fb-20261024-01`, outcome `blocked`, à17:40:54.015Z. Les deux nouvelles tâches `task-review-a-final-evidence` et `task-review-b-final-evidence` sont ensuite `blocked`. L'événement fournisseur seq1303, à17:45:05.899Z, conserve un retour `STALE_REVIEW` pour le reviewer B. Son compte rendu seq1330 conserve les sources A/B attendues et le SHA combiné correct, ainsi que les essais avec versions fraîches et preuves finales seulement. Le code ne déclenche ce code d'erreur qu'au garde cité ; le retrait de preuves historiques ne répare donc pas cet état.

Voie prise en charge, sans modifier le moteur : `delegateTask()` autorise une tâche `blocked`/`changes_requested`/`waiting_provider` dont la tentative active est `exited` ou `interrupted` (lignes1755–1762). Le chef peut redéléguer explicitement A et B, faire constater le contenu courant et produire de nouvelles passations sans imposer de code métier supplémentaire. Une nouvelle passation place la cible dans le parcours de revue ; les reviewers doivent alors utiliser ses nouveaux IDs/source, les preuves de la tentative courante et le candidat combiné courant. Repréparer/réconcilier ce candidat et relire les trois passations actuelles conserve les protections d'acceptation. Ne pas réutiliser les anciennes identités de tentative comme si elles appartenaient aux nouvelles passations.

Ce diagnostic ne propose ni écriture directe du statut, ni acceptation des anciennes revues, ni assouplissement de STALE_REVIEW. Le garde fonctionne conformément au parcours implémenté ; aucune contradiction produit supplémentaire n'est démontrée par ce rejet. La formulation de l'erreur est générique et n'indique pas lequel de ses termes est faux.
