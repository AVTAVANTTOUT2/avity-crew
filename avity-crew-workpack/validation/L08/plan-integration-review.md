# Revue indépendante — amendements de plan et intégration

What this change does: le candidat raccorde les amendements de mission décidés, les résultats canoniques de revue, le contrôle des preuves courantes, la relecture durable de configuration et des projections de coordination moins volumineuses dans les prompts.

**Candidat :** `f0d0d077e1ed5464f9dc6e476403e6e349c39bf7`.
**Livraison Store relue :** `7a4e794197e3525604fd3d731b9c1e422b5368bb`, intégrée par `7ded91601fb05a16b8d1a42c12090559961e695c`, puis garde-fou de preuve ajouté dans `f0d0d077`.

**Verdict : aucun défaut actionnable confirmé dans le périmètre demandé.** Aucun blocage nouveau demandé par cette revue. Ce verdict ne qualifie pas un parcours LLM natif de bout en bout et ne remplace pas la recette exécutée séparément par le coordinateur.

Périmètre : `Store.amendTask`, `submitReview`, `deliveryCheck`, `finishRun`, `configureProject` ; raccordements `amend_task`, bootstrap du service et projections de contexte de `coordinator.ts`, `runtime.ts`, `main.ts`. Lecture du graphe, des schémas et des tests concernés pour vérifier ces frontières. Aucun scan global supplémentaire ni réouverture des cinq anciens constats.

## Contrôles exécutés

Les quatre JavaScript locaux Store/coordinator/runtime/main ont été comparés à l'émission ESM du TypeScript extrait du candidat avec les options du dépôt : identité octet pour octet.

Commande exécutée indépendamment sur macOS, **Node 26.12.0** :

```text
node --test dist/tests/plan-state.test.js dist/tests/runtime.test.js dist/tests/config-reload.test.js dist/tests/context-inspection.test.js dist/tests/supervisor-tools.test.js
exit 0 — 25 tests, 25 réussis, 0 échec, 0 ignoré
```

Cette exécution utilise SQLite, Git, HTTP et les services CLI réels des fixtures ; les frontières fournisseur sont explicitement simulées. Aucun CLI Claude/Codex ni modèle n'est lancé par cette revue.

## Amendement d'une mission

Lecture : Store `1190–1355`, transitions de réattribution et graphe `assertAcyclic` ; raccordement `coordinator.ts:260–287,330–336`.

- L'acteur doit conserver l'autorité utilisateur/chef. Le run, l'identité et la date de création de la mission restent immuables ; une tâche terminale ne peut pas être réécrite.
- La décision doit être approuvée et viser cette tâche ou l'ensemble du run. Chaque ancienne tentative doit être observée sortie/interrompue ; les intentions fournisseur non réconciliées empêchent le changement.
- Le graphe vérifie cycles et dépendances inconnues. Les scopes restent relatifs et les exclusions du projet sont conservées.
- La révision archive ancienne/nouvelle TaskSpec, raison, décision et génération. L'incrément de génération empêche l'ancienne tentative/passation d'être réutilisée. Les critères du run ne sont pas modifiés.
- Les tests vérifient refus d'autorité/décision/processus/DAG/scope, conservation des questions, transactions annulées avec leur événement et rejeu idempotent. Le parcours de nouvelle soumission conserve les critères globaux et refuse l'ancien handoff.

## Résultat canonique d'une revue et preuves courantes

Lecture : Store `1918–1996`, `2082–2184` et garde-fou `788–803`.

Une revue produit un snapshot canonique, un artefact lié à la tentative reviewer et une vérification de l'exécution de sa mission de contrôle. Cette preuve n'est incorporée à la clôture que si sa revue est **approved**, sans finding bloquant, explicitement comprise dans l'acceptation courante de cette livraison, avec SHA testé, tâche et génération encore cohérents. Le snapshot doit relire exactement le JSON canonique de la revue ; mode, exécution, producteur, critères et artefact unique de la preuve sont vérifiés.

Le fait qu'une mission ait terminé une revue négative ne transforme donc pas cette revue en preuve d'acceptation de la livraison. Les tests refusent un contrôle `changes_requested`, une ancienne revue approuvée qui n'appartient pas à l'acceptation suivante et un snapshot canonique corrompu. Ils vérifient aussi l'atomicité résultat/preuve/transition/événement.

Le scénario positif attribue le critère d'écriture au writer et le critère de revue à une mission reviewer distincte. Les deux critères globaux restent inchangés ; la clôture utilise l'artefact de contrôle réel pour le critère de revue, sans faire revendiquer cette revue par le writer.

Deux probes supplémentaires ont utilisé uniquement les API publiques du Store et les helpers de fixture extraits du candidat dans un module temporaire, sans modification du produit ni accès SQL direct :

| Entrée proposée à l'acceptation | Résultat observé |
| --- | --- |
| Vérification rattachée à la tâche writer mais contenant l'ID d'un autre critère | `STALE_EVIDENCE`, tâche toujours `in_review`, zéro acceptation |
| Vérification valide lors de l'ancienne tentative de la même tâche, réutilisée après amendement/réattribution avec un snapshot documentaire identique | `STALE_EVIDENCE`, tâche toujours `in_review`, zéro acceptation |

Dans les deux cas, les critères du run restent identiques. Le second probe vise la provenance de tentative, même lorsque le SHA testé pourrait à lui seul sembler compatible. Un artefact d'une autre tâche est également refusé dès l'enregistrement de preuve (`WRONG_PRODUCER`).

## Configuration : ordre du bootstrap et persistance

Lecture : `main.ts:14–24,36–54` et `Store.configureProject:202–217`.

La racine canonique identifiée par Git est résolue avant la recherche de `.avity-crew.json`. Le fichier complet est validé avant son application. **L'appel à `configureProject` intervient après la réussite de `startTransport` et de son verrou singleton**, puis le runtime est construit avec la configuration actualisée. Une API provisoire refuse les requêtes tant que le runtime n'est pas prêt.

Le Store met à jour le champ `config` dans la transaction en préservant les autres métadonnées persistées ; l'objet en mémoire est ensuite actualisé. Les deux tests CLI/services passent : dossier sans Git et lancement du vrai service avec `--project` pointant vers un sous-dossier Git. Après arrêt observé, la nouvelle configuration reste présente à la réouverture du Store ; identité, racine, répertoire de données, Git commun, `map_version:17`, date de création et run planning préexistant restent identiques. Aucun run modèle n'est créé.

## Projection de coordination et accès aux détails

Lecture : `runtime.ts:684–805`, compilation existante des couches de run/mission, `get_status` ciblé et `collect_delivery`.

Les états de coordination deviennent des projections : IDs, états, génération, références et comptes. Les résumés de handoff sont limités à 800 caractères avec indicateur `summary_truncated` ; les limites sont annoncées par leur compte. Les descriptions complètes des critères du run et de la mission assignée restent dans leurs couches de contexte, séparément de ces projections. Le prompt indique les outils permettant de relire la TaskSpec et la passation complètes.

Probe indépendant, avec Store réel et frontière fournisseur fake qui capture la demande puis s'arrête par un marqueur contrôlé :

```json
{
  "chief_request_reached_fake": true,
  "summary_projected_to_800": true,
  "truncation_flag_present": true,
  "complete_summary_retrievable": true,
  "complete_limitation_retrievable": true,
  "run_criteria_complete_in_both_prompts": true,
  "assigned_criterion_complete": true,
  "assigned_TaskSpec_retrievable": true,
  "LLM_started": false
}
```

Le handoff de ce probe contient un résumé de 900 caractères et une limite de 1 100 caractères ; `collect_delivery` restitue ces deux valeurs intégralement. Le critère assigné comporte une longue description distincte conservée dans le prompt du worker, et `get_status(task_id)` restitue sa TaskSpec exacte. Les deux prompts vérifiés conservent les descriptions de tous les critères globaux. Les fixtures et modules temporaires ont été nettoyés.

## Limites

- Node 24, suite globale de 167 tests, lint/typecheck/build globaux et CI distante n'ont pas été rejoués par ce relecteur. Les résultats annoncés par le coordinateur restent des preuves distinctes des 25 tests et probes ci-dessus.
- Le résultat de la recette native en cours n'est pas supposé. Aucun accès fournisseur, quota, coût ou capacité de charge n'est déduit des fixtures.
- Le probe de projection vérifie les chemins précis résumé/détail/critères ; il ne promet pas que toute accumulation arbitraire d'états tiendra dans n'importe quel budget. Un budget insuffisant doit rester une erreur explicite, sans disparition des exigences.
- Aucun fichier produit, contrat, test persistant, manifeste, mémoire projet ou état de coordination n'a été modifié. Seul ce rapport est ajouté.
