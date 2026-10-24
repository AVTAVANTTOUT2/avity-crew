# L02 — Revue indépendante du premier candidat

Relecteur : session `l00_acceptance_map`, distincte de l'auteur du stockage.
Date : 2026-10-24. Checkout exclusif : `/Users/zeldris/.codex/worktrees/avity-crew-l02-review`.
Handoff : `handoff-f5dc9f7cd9bb486aaf1e8e29161fd229`.
Base : `git:4767e10e03806309bc629d4dc1e65cedc0604f0a`.
Source et candidat combiné : `git:f5f50bd0415793b5b1656b9b5816fcb7764e7f0c`.

What this change does: it adds persistent SQLite state, atomic mutations and events, operation replay, attempt ownership, migrations, private artifacts, backups, and project namespaces. It keeps storage internal; authenticated RPC and full delivery acceptance belong to L07.

## Must fix

1. **Task events lose the identity of the task and session they describe** (`packages/storage/src/index.ts:357`, `:421`).
   - **What this is:** `append` builds the public event journal; `mutate` records each committed operation there.
   - **Problem:** task/attempt fields come from the caller Actor, while the payload contains only `request_key`. After `createTask` and `claimTask` by user/chief, the observed events have `task_id:null`, `attempt_id:null`, `session_id:null`, although the target task, attempt and session exist. The public journal cannot identify the changed entity without reading the private requests table or guessing from current state. That breaks useful provenance and prevents reliable targeted routing in L07.
   - **Fix:** pass the operation's target IDs and relevant generation to the event, independently of `actor_id`. Keep the request key and minimal entity references without copying sensitive inputs. Cover create, claim and observation events, including two tasks changed by the same chief.
   - **If we skip it:** a reconnecting consumer cannot reliably tell which task changed or which session should receive an update.

2. **Writing an existing corrupted artifact reports success** (`packages/storage/src/index.ts:1162`).
   - **What this is:** `writeArtifact` returns a content-addressed reference that is supposed to identify the supplied immutable bytes.
   - **Problem:** if the digest path already exists as a regular file, its content is never checked. Reproduction: write content A, corrupt that digest file in a disposable fixture, write A again. The second write returns the expected reference as success, but reading it immediately fails with `ARTIFACT_CHANGED`. A caller can therefore persist a successful reference to bytes that were not stored correctly.
   - **Fix:** verify the existing regular file against the expected bytes/digest and fail explicitly if corrupted. Do not silently overwrite evidence or return success. Add the duplicate-write corruption regression.
   - **If we skip it:** retry after a damaged artifact can falsely report a durable delivery and leave unreadable evidence in later handoffs/backups.

3. **Starting inside a Git subdirectory chooses that subdirectory as the project root** (`packages/storage/src/project.ts:46`).
   - **What this is:** `identifyProject` supplies both the shared project identity and its root to storage and later context/workspace consumers.
   - **Problem:** the Git common directory correctly gives `/repo` and `/repo/src` the same project ID, but `root` remains the original current directory. In a disposable Git repository, `identifyProject(repo/src)` returned the `src` root with the same ID as `identifyProject(repo)`. `Store` persists the first project record, so opening from a subdirectory first can retain the wrong root for L03 and miss instructions/files above it.
   - **Fix:** use the real Git top-level for root when Git is available; keep the real current directory for a non-Git documentary project. Preserve meaningful path spaces when removing Git's output newline. Test a first opening from a nested directory.
   - **If we skip it:** project identity looks correct while context and relative paths address only a fragment of the repository.

Verdict: fix 1, 2 and 3 first.

## Independent validation actually executed

Platform: macOS arm64, installed Node 26.12.0. The checkout SHA matched the submitted candidate and remained clean; no product code was changed by the reviewer.

| Command / check | Observed result |
|---|---|
| `npm ci` | exit 0 ; 29 packages added, 35 audited ; no vulnerability reported by npm |
| `npm run check` | exit 0 ; strict types, formatting and build ; 25 tests passed, 0 failed/skipped/cancelled |
| `git diff --check 4767e10e03806309bc629d4dc1e65cedc0604f0a f5f50bd0415793b5b1656b9b5816fcb7764e7f0c` | exit 0 |
| Source/caller review | SQLite transaction/authority/replay paths, current attempt guard, records/messages/decisions, schema migrations, artifact/backup paths, identity helper, tests and documented scope inspected |
| Disposable compiled-code probes through context-mode | All three findings reproduced through the real Store/identifyProject APIs; temporary files removed after closing SQLite |

The 25 tests exercise real SQLite files, two child processes released by a barrier, atomic rollback on event failure, old-attempt rejection, version migration, SIGKILL rollback, uncertain operations, event pagination, coherent backup, source provenance, failed messages and private artifacts. These checks provide useful evidence but do not cover the three cases above.

## Reproduction details

The event probe created one valid run/task with a user Actor having no task/attempt scope, then claimed the task with `session:review`. Observed:

```text
task.created: task_id=null, attempt_id=null, session_id=null,
              payload={request_key:"key:random-create"}
task.claimed: task_id=null, attempt_id=null, session_id=null,
              payload={request_key:"key:random-claim"}
```

The claim response contained the real attempt ID, and the supplied session ID was known; neither was retained in the event. This confirms an event-target problem, not an authentication problem.

The artifact probe called `writeArtifact('required immutable content')`, changed that returned digest file to `corrupted`, then called the same write again. The second write returned its reference/revision without error; `readArtifact` returned `ARTIFACT_CHANGED` immediately afterwards. The identity probe initialized an isolated Git repository with a nested `src` directory; its ID was shared correctly while the root retained `/src`.

Not checked: the reviewer did not rerun the coordinator's Node 24 execution on this rejected candidate. Remote CI, real provider integrations, authenticated RPC, UI and final package delivery are not validated by this L02 review. Storage Actor remains an internal trusted-service input as documented; no extra UI/RPC scope is requested here.
