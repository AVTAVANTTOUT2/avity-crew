# Livraison L05 — Adaptateur Codex réel

## Corrélation et état

Agent : l05-codex. Tentative : 1. Date : 24 octobre 2026. État déclaré : **delivered**, en attente de revue indépendante. Base L01 acceptée : git:4767e10e03806309bc629d4dc1e65cedc0604f0a. Révision livrée et testée : git:f1d594a488438dbee12f546f4bdab28a44b42c9b. Worktree : /Users/zeldris/.codex/worktrees/avity-crew-l05, branche build/l05-codex. Aucun changement préexistant dans ce worktree ; état final propre.

Version native : Codex CLI 0.163.0, binaire /Users/zeldris/.local/bin/codex, macOS arm64 ; contrôles locaux v26.12.0, puis Node 24.22.1. Authentification native conservée, aucun cache de connexion copié. Modèle demandé : null (défaut CLI isolé du config utilisateur). Modèle effectif : **non exposé par exec JSONL**, aucune déduction.

## Livraison

- CodexProvider : découverte du binaire, démarrage/reprise UUID exacts, modèle configurable, cwd, prompt stdin et arguments sans shell. Aucun --last. Sandbox et approbation proviennent du run, sans option de bypass.
- Décodeur : sessions, texte terminé, outils et identifiants, tokens réels, erreurs et diagnostics inconnus ; refus MCP natif transformé en permission/error et résultat faux même avec exit 0.
- Runner partagé L04 utilisé sans duplication. Consommer events en parallèle de result est nécessaire pour la contre-pression. send reste UNSUPPORTED ; les mises à jour attendent le superviseur puis une reprise explicite.
- MCP crew par session : commande/args/env_vars en config, valeurs bridge.env dans env uniquement. Ping réel, token_present true et absence de sentinelle dans les rapports vérifiés.
- Sept tests Codex hors ligne, fixture CLI, script de recette borné, documentation. La fixture MCP partagée a reçu les trois annotations exactes sur autorisation explicite du coordinateur. Aucun manifest, lockfile, contrat, index d'export ni changelog modifié par L05.

Fichiers propres L05 : packages/providers/src/codex.ts ; tests/providers/codex.test.ts ; tests/fixtures/providers/codex-cli.mjs ; scripts/live-codex.mjs ; docs/providers/codex.md. Périmètre partagé transféré : tests/fixtures/providers/mcp-ping.mjs (annotations diagnostiques seulement).

## Résultat par critère

| Critère | Résultat | Preuve |
| --- | --- | --- |
| AC-L05-01 Normalisation | Satisfait | 7 tests Codex et événements réels single/parallel, IDs, commandes, fichiers, MCP, usage et erreurs |
| AC-L05-02 Concurrence | Satisfait | Deux CLI simultanées puis deux reprises simultanées, UUID distincts et ALPHA/DELTA_A vs BETA/DELTA_B sans mélange |
| AC-L05-03 Reprise ciblée | Satisfait | Même UUID et deuxième ligne réelle dans proof.txt ; nouvelle note propre à chaque session concurrente |
| AC-L05-04 Arrêt | Satisfait | Commande sleep 30 observée, SIGINT, résultat faux, puis reprise du même UUID avec recovered.txt |
| AC-L05-05 Preuve réelle | Satisfait | CLI 0.163.0 : modifications et fichiers copiés, MCP tools/call réel, refus natif observé |

## Commandes et résultats

| Commande exécutée | Résultat | Preuve |
| --- | --- | --- |
| npm ci | 0, installation locale | message d'exécution, aucun changement lockfile |
| npm run check | 0 ; typecheck, Prettier, build, 29 tests | check-final.log |
| npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js' | 0 ; 29/29 | node24-final.log |
| git diff --check 4767e10e03806309bc629d4dc1e65cedc0604f0a HEAD | 0 | diff-final.log |
| node scripts/live-codex.mjs /Users/zeldris/avity-crew/avity-crew-workpack/validation/L05/live-single.json single | 0 ; 5 tours réels séquentiels | live-single.json et live-single-command.log |
| node scripts/live-codex.mjs /Users/zeldris/avity-crew/avity-crew-workpack/validation/L05/live-parallel.json parallel | 0 ; 4 tours réels, 2 CLI maximum simultanément | live-parallel.json et live-parallel-command.log |

Les assertions de succès des quatre résultats concurrentiels, d'identité et de token_present réel ont été revérifiées par lecture programmée des rapports. Les cinq SHA256 ci-dessous ont été recalculés après exécution.

## Sessions réelles finales

| Scénario | UUID natif | success adaptateur | exit CLI | sandbox/approval |
| --- | --- | --- | --- | --- |
| edit-and-mcp | 01a16dac-9828-7de2-9213-cfb8872b4888 | true | 0 | workspace-write/never |
| resume-new-note | 01a16dac-9828-7de2-9213-cfb8872b4888 | true | 0 | workspace-write/never |
| interrupt | 01a16dac-e949-7483-b9ab-08abed65d72a | false | 1 | workspace-write/never |
| resume-interrupted | 01a16dac-e949-7483-b9ab-08abed65d72a | true | 0 | workspace-write/never |
| permission-mcp | 01a16dad-27a8-7eb0-9e66-41ccda210ffc | false | 0 | read-only/never |
| parallel-b | 01a16dad-dca7-7b50-a6cb-3477a3f17c15 | true | 0 | workspace-write/never |
| parallel-a | 01a16dad-dcae-7761-b833-4f9e7784db95 | true | 0 | workspace-write/never |
| parallel-resume-b | 01a16dad-dca7-7b50-a6cb-3477a3f17c15 | true | 0 | workspace-write/never |
| parallel-resume-a | 01a16dad-dcae-7761-b833-4f9e7784db95 | true | 0 | workspace-write/never |

Le refus final configure **uniquement en recette** crew.ping approval_mode=prompt sous policy never, via runNative et decodeCodexEvent ; cette règle plus restrictive ne modifie pas le contrat produit. L'événement MCP failed puis permission/error est réellement observé ; le journal MCP contient tools/list et aucun tools/call. La CLI sort 0, mais l'adaptateur renvoie success false. Aucune approbation automatique globale.

## Artefacts copiés et vérifiés

Les fichiers ont été copiés pendant que le dépôt jetable existait, puis leurs empreintes revérifiées. Le scratch du sandbox context-mode est nettoyé à sa fin ; le chemin cwd du rapport est informatif, les copies canoniques ci-dessous persistent.

| Copie canonique dans validation/L05 | SHA256 |
| --- | --- |
| live-single-proof-first.txt | e1d5ae27b3b4eb9208e96b6ec38ce5f774c1c03acdd5ed6e108da206dcc321a2 |
| live-single-mcp-audit.jsonl | 77f86f04cc88c383b81f40a15a53647b37f1442ab5793eb5c652380926708dc0 |
| live-single-proof-resumed.txt | 6523305dc519d9218eea442e567307a45eb48692beb8a444cfebe62f313e6df2 |
| live-single-recovered.txt | 2197338f7a0600b495bf402df6d7b71759c9509bc6b7a400bf209f06a38cf873 |
| live-single-permission-audit.jsonl | 9843b1ae8011db0204eec5fae6cd14e277111006db00d964f23f15478a3cef63 |

## Usage natif disponible

| Tour | input_tokens | output_tokens |
| --- | --- | --- |
| edit-and-mcp | 113217 | 149 |
| resume-new-note | 170400 | 265 |
| interrupt | indisponible | indisponible |
| resume-interrupted | 84813 | 130 |
| permission-mcp | 55261 | 165 |
| parallel-b | 28129 | 32 |
| parallel-a | 28129 | 32 |
| parallel-resume-b | 56917 | 67 |
| parallel-resume-a | 56917 | 67 |

Coût monétaire, pourcentage de contexte et modèle effectif indisponibles ; aucun chiffre inventé.

## Échecs conservés et corrections

1. live-single-initial-denied.json : outil MCP sans annotations, initialisé/listé mais approbation refusée et aucun tools/call. Le décodeur initial gardait seulement tool, puis acceptait le turn.completed. Une régression reproduite rouge dans mcp-denial-before.log passe après correctif dans mcp-denial-after.log ; le refus réel final renvoie maintenant permission/error et success false.
2. live-single-four-proven-verbal-permission.json : quatre preuves réelles positives, dernier scénario fichier read-only insuffisant malgré code script 0. Le modèle a expliqué un refus sans événement outil. Ce scénario **n'est pas compté comme refus natif observé**.
3. live-permission-verbal-only.json : contrôle renforcé en échec (code 1) car aucun outil ; le modèle décrivait même une erreur shell sans événement commande. Le contrôle n'a pas accepté cette seule déclaration. Le test final utilise le refus MCP déterministe plus strict décrit ci-dessus.
4. Première série hors ligne : Operation not permitted était mal classé process ; propriétaire L04 a corrigé classifyNativeError avec régression partagée (f863a5b, présent dans les dépendances).

## Limites et passation

NON EXÉCUTÉ : refus natif réel d'écriture fichier en read-only (deux déclarations de modèle insuffisantes, non comptées), pannes réelles quota/auth/réseau, Linux/Windows et CI distante. Les classificateurs et pannes reproductibles sont couverts hors ligne. L'arrêt d'arbre POSIX est testé ; la limite Windows du runner partagé demeure.

La connexion MCP positive et le refus natif MCP sont réels. Les outils de coordination mutants L07 nécessiteront politique native par outil étroite explicitement autorisée et ACL service ; pas de champ partagé ajouté ici. Les autres versions Codex reçoivent unverified pour MCP et usage. La fin du tour fournisseur ne vaut pas acceptation de livraison.

Intégration : utiliser les commits partagés originels L04 (5bc6ebe, f863a5b, 48e7f33), puis les commits propres L05 6de52f1, 09167f4, 3e7f48d, 0c9c793, f1d594a. Ne pas cherry-pick les doublons locaux e27a50c/5a81535/c6df940. Le coordinateur possède l'export CodexProvider, la revue indépendante, le changelog et le contrôle de la combinaison finale.

Mémoire Serena : aucune écriture hors périmètre ; proposer à l'intégration les décisions durables exec JSONL, reprise UUID exacte/config sandbox sur resume, consommation events+result et politique MCP par outil. Aucune session ou sortie transitoire à mémoriser durablement.
