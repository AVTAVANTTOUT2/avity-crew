# L02 — Revue du candidat corrigé

Relecteur : session indépendante `l00_acceptance_map`, 2026-10-24.
Checkout : `/Users/zeldris/.codex/worktrees/avity-crew-l02-review`.
Handoff : `handoff-46925c7999154c878dc62da01e2c9100`.
Base : `git:b30b3301a826513ed706d248962df1baf44e8354`.
Source/candidat combiné : `git:ea8ac7a9c6d23d077f9239d12ad634b564e05856`.

What this change does: it fixes event target correlation, verifies reused artifact bytes, and resolves Git top-level paths without losing meaningful spaces. It also preserves a new project's identity when Git is initialized later.

## Corrections vérifiées

Les trois findings du premier refus sont corrigés. Un probe indépendant a créé deux tâches avec le même chef, puis attribué et observé une tentative : les événements gardent l'auteur distinct des bons IDs task/attempt/session et ajoutent `subject_id`. Un artefact intact se réutilise ; le même digest corrompu est refusé avec `ARTIFACT_CHANGED`. Un chemin Git contenant un espace final conserve cet espace, retrouve la vraie racine depuis `src` et garde son ID avant/après `git init`.

## Must fix

1. **Reopening after Git initialization still exposes stale non-Git project metadata** (`packages/storage/src/index.ts`, constructeur de `Store`).
   - **What this is:** `Store.project` exposes the durable project descriptor used by context/workspace consumers.
   - **Problem:** the constructor returns the old JSON project record with only `data_dir` refreshed. Reproduction on the corrected candidate: identify a new folder and open/close Store; run `git init`; identify it again and reopen Store. The fresh argument correctly has the `.git` common directory, while `store.project.git_common_dir` remains `null`. Stable identity now reopens the intended database, but the current metadata passed to Store is silently discarded.
   - **Fix:** refresh detected location/Git metadata in the existing project record on open while preserving durable decisions/configuration, creation time and map version. Add a reopen-after-init test; comparing only IDs/data paths misses this case.
   - **If we skip it:** L03/L06 can receive a descriptor still claiming the project has no Git after Git has been initialized, and a stale root can survive a later corrected discovery.

Verdict: fix 1 first. The original rejection and all passing evidence remain preserved.

## Independent checks actually executed

| Command / check | Result |
|---|---|
| `npm ci` | exit 0 ; 29 packages added, 35 audited ; no npm vulnerability reported |
| `npm run check` | exit 0 ; strict types, format, build ; 42 tests passed on Node 26.12.0 |
| `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` | exit 0 ; 42 tests passed on Node 24.22.1 |
| `git diff --check b30b3301a826513ed706d248962df1baf44e8354 ea8ac7a9c6d23d077f9239d12ad634b564e05856` | exit 0 |
| `git rev-parse HEAD` / `git status --porcelain` | Exact candidate SHA ; clean checkout before/after |
| Compiled-API probes in disposable fixtures | Original event/artifact/root defects resolved ; stale stored Git metadata reproduced |

The stale-metadata probe used a folder named `repo `, preserving its final space. It opened and closed Store before Git initialization, then reopened using `identifyProject(repo/src)`. Observations: `stableId:true`, `rootMatches:true`, `spacePreserved:true`, fresh `git_common_dir` ending in `repo /.git`, stored `git_common_dir:null`. No provider CLI or product code was changed/launched by this review. Temporary fixture databases were closed and removed.

The final suite includes real SQLite concurrency, rollback, migrations, SIGKILL recovery, idempotence, provenance, backup and isolation, plus the integrated L04 offline provider fixtures. Passing that combined suite is useful evidence; it does not cover the newly observed reopen metadata case.

Not checked: remote CI, real provider calls, authenticated RPC, UI and release installation are not part of this review. No success in those scopes is claimed.
