# L01 — Revue du deuxième candidat

Relecteur : session `l00_acceptance_map`, indépendante du coordinateur.
Date : 2026-10-24. Checkout : `/Users/zeldris/.codex/worktrees/avity-crew-l01-review`.
Handoff : `handoff-465dabb22b5a438c85b3636f2925c3cc`.
Base : `git:e42d658c2e2cf55bc70973e4f6b893d3b61850ba`.
Source et candidat combiné : `git:82761cd3f7b94ad00320a01541c38024256b8269`.

What this change does: it fixes the dropped fake update, checks deliveries against current task ownership, and resolves the fake result when the stream ends or is interrupted. It also ties validation types to schema names and makes product schemas and fixtures independent of the construction workpack.

## Corrections vérifiées

- Le finding précédent est corrigé : `send` refuse explicitement avec `UNSUPPORTED`, avec assertion de rejet.
- `assertCurrentAttempt` compare handoff, tentative et `TaskState.active_attempt_id/generation`, ainsi que tâche/run ; les anciennes tentatives cohérentes avec elles-mêmes, tentatives inactives et producteurs étrangers sont refusés.
- Le résultat fake ne précède plus la consommation du flux. L'interruption après `iterator.next()` garde le texte partiel et produit `success:false` / `SIGINT`.
- `validate` lie nom de schéma et type généré, refuse les sous-pointeurs arbitraires et utilise Ajv strict. La configuration est générée depuis le schéma existant.
- Les deux schémas copiés dans `packages/contracts/schema/` sont sémantiquement identiques à ceux du workpack. Les fixtures utilisées par les tests sont autonomes dans `tests/fixtures/contracts/`.
- Les gardes de transition/clôture et de preuve simulée ont des tests négatifs. Les intégrations persistantes complètes restent aux lots concernés.

## Must fix

1. **An error event without details can become a successful fake result** (`packages/providers/src/fake.ts`, branche `event.type === 'error'`).
   - **What this is:** `ProviderEvent.error` is optional in the shared type, so an error event with no detail is a permitted input to `FakeProvider`.
   - **Problem:** the new stream implementation sets `error = event.error ?? null`, then computes success with `!error`. A script containing an error event with no payload followed by a successful result now returns `success:true` and `error:null`. The previous implementation rejected success whenever any event had type `error`.
   - **Fix:** keep the presence of an error event independently of its optional detail, or turn a missing detail into an explicit protocol error. Add one focused test for this permitted input.
   - **If we skip it:** the deterministic fake can turn an observed failure into success, weakening later supervisor/error tests.

Verdict: fix 1 first. The first rejection remains preserved in `review.md` / `review.json`.

## Contrôles réellement exécutés sur le candidat

| Commande / contrôle | Résultat |
|---|---|
| `npm ci` | exit 0 ; 28 packages ajoutés, 33 audités ; npm ne signale aucune vulnérabilité |
| `npm run check` | exit 0 ; typage strict, format, build ; 11 tests réussis, aucun échec/skip/annulation |
| `node bin/avity-crew.mjs --help` | exit 0 ; socle incomplet explicitement annoncé |
| `node bin/avity-crew.mjs --version` | exit 0 ; `0.1.0` |
| `git diff --check e42d658c2e2cf55bc70973e4f6b893d3b61850ba 82761cd3f7b94ad00320a01541c38024256b8269` | exit 0 |
| `git rev-parse HEAD` et `git status --short` avant/après | SHA candidat exact ; checkout propre |
| Comparaison JSON des schémas runtime/config produit et workpack | Identité sémantique des deux schémas |
| Lecture du diff final, des gardes, du générateur, des tests ajoutés et du traitement de la revue Claude | Corrections ci-dessus observées ; finding 1 reste reproductible |

Probe supplémentaire exécuté via JavaScript context-mode contre le code compilé, sans modifier les sources :

```js
const provider = new FakeProvider([
  { type: 'error', provenance: 'simulated' },
  { type: 'result', success: true, provenance: 'simulated' }
]);
const handle = provider.start({
  cwd: '/tmp', prompt: 'test', model: null, role: 'developer',
  permissions: { sandbox: 'read-only', approval: 'never' }
});
for await (const event of handle.events) { /* observed error, result */ }
const result = await handle.result;
```

Résultat observé : `success:true`, `error:null`, `exit_code:0`, provenance `simulated`. Ce résultat est le motif du second refus.

Not checked: le relecteur a exécuté ces commandes avec Node 26.12.0. Les 11 tests Node 24.22.1 du coordinateur restent des preuves distinctes non rejouées ici. CI distante, providers réels et recette installée ne sont pas validés par cette revue du socle.
