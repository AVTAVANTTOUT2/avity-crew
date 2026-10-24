# L01 — Revue indépendante du candidat initial

Relecteur : session `l00_acceptance_map`, distincte du coordinateur et auteur du code.
Date : 2026-10-24. Checkout réservé : `/Users/zeldris/.codex/worktrees/avity-crew-l01-review`.
Handoff : `handoff-298b85db3103496e81b4a2a7b9e508bb`.

What this change does: it adds the TypeScript workspace, shared contracts, validation, task invariants, a simulated provider, an initial help command, and offline CI checks. The CLI states that product orchestration is not implemented yet.

## Must fix

1. **The simulated provider drops updates after saying they are queued** (`packages/providers/src/fake.ts:73`).
   - **What this is:** `ProviderProcess.send(update)` reports whether an update was sent or queued. The fake provider says its mid-turn input capability is unsupported.
   - **Problem:** its implementation always returns `queued` and ignores the argument. There is no queue, consumption path or later continuation that can deliver the update. The compiled-code probe below returned `queued` for a new decision, then only the default successful result. This violates L01's requirement to explicitly refuse an unsupported operation.
   - **Fix:** reject this fake operation with `CrewError('UNSUPPORTED', ...)` and add one assertion that the rejection is explicit. No queue is needed for L01.
   - **If we skip it:** later supervisor tests can claim that an update was retained when the fake adapter silently discarded it.

Verdict: fix 1 first.

## Revisions and independent checks

Base : `git:e42d658c2e2cf55bc70973e4f6b893d3b61850ba`.
Source and combined candidate : `git:78ffc5bafd7c593cb779961a7ba86e23feb55398`.
`git rev-parse HEAD` matched the candidate. The checkout was clean before installation and remained clean after checks; only ignored dependencies, generated sources and build outputs were created.

| Command / check | Observed result |
|---|---|
| `npm ci` | exit 0 ; 28 packages added, 33 audited ; no vulnerability reported by npm |
| `npm run check` | exit 0 ; strict typecheck, Prettier, build, 7 tests passed, 0 failed/skipped/cancelled |
| `node bin/avity-crew.mjs --help` | exit 0 ; explicit foundation-only status |
| `node bin/avity-crew.mjs --version` | exit 0 ; `0.1.0` |
| `node bin/avity-crew.mjs unknown` | expected exit 2 ; diagnostic on stderr |
| `git diff --check e42d658c2e2cf55bc70973e4f6b893d3b61850ba 78ffc5bafd7c593cb779961a7ba86e23feb55398` | exit 0 |
| Inspection of contracts, generated-schema path, core invariants, fake provider, CLI, tests, callers, manifests, lockfile/configuration and workflow | Provider-native types remain confined by the common port; invalid IDs/version/fields are rejected; task acceptance differs from process success; simulated provenance is explicit. Finding 1 remains. |

The additional probe ran as JavaScript through context-mode against the compiled candidate, without modifying code:

```js
const { FakeProvider } = await import(
  'file:///Users/zeldris/.codex/worktrees/avity-crew-l01-review/dist/packages/providers/src/index.js'
);
const provider = new FakeProvider();
const capabilities = await provider.probe();
const handle = provider.start({
  cwd: '/tmp', prompt: 'test', model: null, role: 'developer',
  permissions: { sandbox: 'read-only', approval: 'never' }
});
const sendResult = await handle.send('new decision: use port 9876');
```

Observed: `capabilities.mid_turn_input.status === 'unsupported'`; `sendResult === 'queued'`; the event stream contained only `{type:'result', success:true, provenance:'simulated'}`; the final result was simulated success with empty text. Source inspection confirms there is no retained update.

Not checked: remote CI and real providers are outside L01's offline acceptance. Node 24 checks reported by the coordinator were reviewed but not rerun by this reviewer; this checkout was checked on the installed Node 26.12.0. Packaging/install portability remains for later lots. This report rejects the current candidate and does not accept L01.
