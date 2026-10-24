# L03 — Correction ciblée après revue d'expurgation

Rejet traité : `review-18d2e155e6b04fcdbbf173d1df9e8c65`, preuve du relecteur dans `privacy-review.md`. Source initiale : `6559d41750fc139081916d9e0840235e248a9baa`. Source corrigée : `cbb6d4d43af2a3eb5711d281eba5ddcf3a724b35`, branche `build/l03-context`, worktree `/Users/zeldris/.codex/worktrees/avity-crew-l03`.

## Cause et correctif

L'expurgation de données structurées du compilateur ne s'appliquait pas aux champs contenus dans une source JSON lue comme chaîne. La regex historique reconnaissait `api_key=valeur` mais pas le guillemet qui termine une clé JSON. Une valeur synthétique sous une clé citée pouvait donc traverser le prompt.

Un prétraitement ciblé reconnaît les paires clé/chaîne JSON en respectant leurs échappements. Il décode la clé pour identifier les noms sensibles, y compris `api\u005fkey`, puis remplace uniquement la valeur sensible par `[REDACTED]`. La clé, son séparateur, le reste du fichier et les propriétés non sensibles sont conservés. Les traitements existants des autres formes restent présents. Aucun fichier entier n'est masqué.

Diff du correctif : `packages/context/src/project.ts` (17 lignes) et `tests/context.test.ts` (64 lignes de régression). Aucun contrat, manifest, lockfile, export, fixture MCP, helper de processus ni autre module n'a été modifié. Aucun fournisseur réel ni sous-agent lancé.

## Rouge avant, vert après

Le nouveau test crée réellement `src/billing/settings.json` dans un projet jetable, puis utilise `inspectProject`, `selectTaskSources` et `compileContext`. Les seules valeurs secrètes utilisées sont synthétiques.

Commande ciblée après `npm run build` :

`node --test --test-name-pattern "quoted JSON source" dist/tests/context.test.js`

1. Avant le correctif, sur l'implémentation `6559d41` avec le nouveau test : build code 0, test code **1**, une assertion échoue : « A quoted JSON API key must not reach the provider prompt ».
2. Après le prétraitement : build code 0, même test code **0**, 1 test réussi.

Le test vérifie les champs `api_key`, `password` et `OPENAI_API_KEY`, une clé encodée Unicode, et des valeurs contenant espaces, guillemets, backslash, saut de ligne, tabulation et Unicode. Il vérifie jusqu'au prompt final l'absence des marqueurs synthétiques, la présence du texte utile et des critères, un JSON expurgé toujours valide, la valeur non sensible `timeout_ms` conservée, le flag d'expurgation, le SHA-256 des octets originaux et le fichier sur disque inchangé. Le probe public `redactContext` est également contrôlé, ainsi que la forme historique `api_key=synthetic`.

## Validation du candidat corrigé

Les contrôles suivants ont été exécutés sur le même état des fichiers que le commit `cbb6d4d43af2a3eb5711d281eba5ddcf3a724b35`, avant sa création, sans modification ultérieure du code :

| Commande | Résultat |
|---|---|
| `npm run check` | code 0 ; typage, format, build et **52 tests réussis**, dont 9 contexte, sur Node 26.12.0 |
| `npm exec --yes --package=node@24.22.1 -- node --test dist/tests/context.test.js` | code 0 ; **9 tests réussis** sur Node 24.22.1 |
| `git diff --check` | code 0 |

Les six AC-L03 restent inchangés et leur couverture initiale est décrite dans `checks.md`. La nouvelle régression complète la frontière des secrets sans retirer de contrainte, de critère ou de contenu utile. Les limites générales déjà documentées (scanner borné, estimation de tokens, détection de formes de secrets connues, recette fournisseur hors de ce composant pur) restent applicables. L'exemple `context-example.json` reste une preuve historique du premier candidat, pas une nouvelle exécution attribuée au correctif.
