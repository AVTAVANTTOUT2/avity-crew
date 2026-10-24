# L04 — Livraison de l'adaptateur Claude Code

Propriétaire : `l04-claude` (session d'agent `l00_provider_audit`). Base L01 acceptée : `4767e10e03806309bc629d4dc1e65cedc0604f0a`. Branche : `build/l04-claude`. Worktree : `/Users/zeldris/.codex/worktrees/avity-crew-l04`. Candidat livré et testé : `bb5ec87f157ccaae76277ce04058854927ac8182`.

## Résultat

L'adaptateur `ClaudeProvider(binary = 'claude')` implémente découverte locale, flux JSONL, reprise par UUID exact, modèle configurable, permissions natives et MCP de session. Le runner commun `process.ts` est partagé avec L05 : spawn sans shell, prompt stdin, environnement bridge sans valeurs dans argv, masquage des secrets avant événement/résultat, stderr séparé, UTF-8 fragmenté, limites en octets et backpressure. Son API est `runNative(provider, binary, args, request, decode)`, avec `NativeDecoder`, `validateProviderRequest` et `classifyNativeError`.

Le consommateur lit `events` en parallèle de `result`. La réussite exige un résultat natif explicite, une sortie 0 et aucune erreur/interruption. `send()` lève `UNSUPPORTED` : L07 doit conserver les mises à jour pour une reprise ciblée. Les événements inconnus restent des diagnostics expurgés ; un simple `rate_limit_event` ne provoque pas un faux échec.

## Révisions et fichiers

- `5bc6ebe786aa30842d6d5dc672f18ed4d5e8257c` : runner, tests de processus et bridge MCP minimal partagé.
- `f863a5b0ef622a1e104e9b593743dacfb7c60f65` : refus macOS `Operation not permitted`, identifié par L05, puis corrigé avec régression.
- `48e7f33549b93a8dd5421a203ebb5c3b293f6095` : limites UTF-8 en octets, masquage d'identifiants et isolation simultanée simulée.
- `bb5ec87f157ccaae76277ce04058854927ac8182` : `packages/providers/src/claude.ts`, `tests/providers/claude.test.ts`, `tests/fixtures/providers/claude-events.jsonl`, `scripts/live-claude.mjs`, `docs/providers/claude.md`.

Aucun contrat, manifest, export partagé, lockfile ni changelog n'a été modifié. Les exports et l'intégration restent au coordinateur. Les preuves canoniques sont hors de ces commits de code.

## Vérifications locales

| Commande | Environnement | Résultat |
|---|---|---|
| `npm ci` | Node 26.12.0 / npm 11.20.0 | code 0, 0 vulnérabilité signalée par npm |
| `npm run check` | Node 26.12.0 | code 0 : typecheck, Prettier et 25 tests réussis |
| `npm exec --yes --package=node@24.22.1 -- node --test dist/tests/providers/process.test.js dist/tests/providers/claude.test.js` | Node 24.22.1 | code 0, 13 tests réussis |

Les tests de providers sont **simulés** : fixtures JSONL et petits processus Node jetables. Ils couvrent fragmentation multioctet, fin sans saut de ligne, événement inconnu, 700 événements avec consommateur lent, deux sessions simultanées sans mélange, erreurs/binaire absent, identité de reprise incorrecte, JSON malformé et ligne UTF-8 trop grande, secrets stdout/stderr/résultat, faux succès après erreur et interruption. Le test d'arbre POSIX lance un petit-fils qui ignore SIGTERM et vérifie sa disparition après escalade. Les types, contrats et protections existants n'ont pas été affaiblis.

## Vérifications live

Commande : `node scripts/live-claude.mjs /Users/zeldris/avity-crew/avity-crew-workpack/validation/L04/claude-live-report.json`, exécutée depuis le worktree, code 0. Source enregistrée dans le rapport : `bb5ec87f157ccaae76277ce04058854927ac8182`. CLI observée : Claude Code `2.1.304`, connexion native, aucun bypass. Les scénarios ont été exécutés séquentiellement, un seul CLI externe à la fois. Le dossier temporaire avec espaces a été supprimé après les assertions ; aucun projet utilisateur n'a été modifié.

| Scénario | Preuve obtenue |
|---|---|
| Fichier réel et MCP | `greeting.txt` exactement `AVITY_CREW_L04\n` ; `tools/call` réel sur `ping`, et `token_present: true` constaté dans le résultat d'outil sans divulguer sa valeur |
| Reprise exacte et note nouvelle | même session `d094e6df-b621-4d4b-a8b0-86918d460c24`, note antérieure `CREW_L04_MEMORY`, fichier devenu `AVITY_CREW_L04\nDELTA_L04\n` |
| Autre session native | `95daad2a-a07e-4c36-92b5-f6190a67f031`, identité différente et réponse propre à sa mission |
| Frontière outils lecture seule | `forbidden.txt` absent ; réponse explicative normale, sans présenter la fin de tour comme livraison métier |
| Refus natif contrôlé | requête Bash dans un contexte natif restreint sans règles utilisateur : événement permission et erreur `permission`, `success: false` malgré sortie CLI 0 ; fichier de contrôle absent |
| Interruption réelle | session `e668903a-8eeb-4693-a252-1ab61f5b469f` interrompue après initialisation, résultat `success: false`, signal `SIGINT`, malgré sortie CLI 0 |

La sonde de refus utilise le même runner et décodeur avec des options natives de contrôle explicites ; elle est distinguée de l'exploitation normale de `ClaudeProvider`. La matrice est dans `provider-capabilities.json` et les résultats structurés dans `claude-live-report.json`.

## Critères et limites

AC-L04-01 : flux et erreurs vérifiés en simulation, flux réel reçu. AC-L04-02 : identités attachées et reprises ciblées, concurrence vérifiée en simulation et sessions réelles distinctes en séquence. AC-L04-03 : reprise réelle et contexte nouveau observés. AC-L04-04 : refus réel explicite et interruption réelle, arrêt d'arbre éprouvé par processus jetables. AC-L04-05 : modifications effectives et appel MCP réel observés.

NON EXÉCUTÉ : deux CLI Claude réels simultanés (créneau limité à un CLI externe ; recette concurrence L11), validation Linux/Windows, panne réseau/quota/authentification réelle provoquée. Le modèle effectif est présent dans le diagnostic natif init mais n'a pas été capturé par le rapport live ; il reste non renseigné dans ces preuves. Les valeurs détaillées d'usage n'ont pas été archivées, seuls leurs événements sont attestés. La fixture vérifie leur normalisation.

L'isolation est celle des permissions natives Claude, pas un nouveau sandbox OS. Lecture seule limite les outils intégrés à Read/Glob/Grep ; les outils MCP devront appliquer les ACL de L07. `acceptEdits` n'ajoute pas d'autorisation Bash générale. Sur Windows, le runner arrête seulement l'enfant direct ; l'arrêt d'arbre n'y est pas promis. Les versions autres que 2.1.304 sont signalées `unverified`. La revue indépendante et la validation après intégration appartiennent au coordinateur ; cette livraison ne s'auto-accepte pas.
