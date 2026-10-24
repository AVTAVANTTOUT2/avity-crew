# Livraison L05 — Codex natif, configuration et MCP bornés

## Corrélation et état

Agent l05-codex, tentative 1. État déclaré : **delivered**, en attente de revue indépendante. Révision finale livrée et vérifiée : **git:7fb39c6ca135eddab75c1581843cd13965bf3f42**. Base L01 acceptée : git:4767e10e03806309bc629d4dc1e65cedc0604f0a. Worktree /Users/zeldris/.codex/worktrees/avity-crew-l05, branche build/l05-codex, propre avant et après les vérifications. Aucun changement utilisateur préexistant à écraser.

Environnement : macOS local, Node v26.12.0, puis Node 24.22.1. CLI native **Codex 0.163.0**, binaire /Users/zeldris/.local/bin/codex. Les deux recettes finales SINGLE et PARALLEL2 portent exactement la même source, sans réétiquetage de preuve d'un ancien commit.

## Résultat livré

CodexProvider utilise exec --json, stdin, arguments sans shell, cwd explicite et reprises UUID exactes avec nouveau contexte. Aucun --last, aucune émulation de terminal, aucun bypass d'approbation. Sessions, texte terminé, outils/IDs, tokens réels, erreurs et diagnostics inconnus sont normalisés. Un arrêt demandé ou un refus réel interdit success:true. send est UNSUPPORTED ; L07 conserve la mise à jour puis reprend le bon UUID.

La configuration native est chargée : aucun --ignore-user-config, aucune redéfinition CODEX_HOME et aucune copie du config ou de l'authentification. model:null ne passe pas --model ; la CLI résout ses préférences. Modèle demandé lors des recettes : null. Modèle effectif : **non exposé par exec JSONL**, aucune déduction ; aucun prix, coût ou pourcentage de contexte inventé. Les permissions explicites du run restent appliquées par les mécanismes natifs.

Le périmètre MCP est restreint par run : features.plugins=false local au processus, puis préflight natif mcp list --json dans le cwd de chaque start/resume, sans cache, borné à 10 s/maxBuffer 1 MiB. Les MCP ordinaires découverts sont désactivés via enabled=false ; seul le bridge crew est ajouté, ou aucun serveur actif sans bridge. Collision crew, identifiant non représentable, inventaire invalide ou erreur native sont refusés avant le tour. Les exceptions n'incluent aucun stdout/stderr brut de configuration. Outils et instructions packagés des plugins sont exclus pour ce processus ; instructions natives hors plugins et protections applicables restent gérées par Codex.

La preuve native native-config-final-probe.json utilise les arguments produits par le code final, sans LLM ni démarrage de serveur : avec bridge hasAmbient=false/hasCrew=true/otherCount=0 ; sans bridge false/false/0. Les sondes ont montré que remplacer la seule table racine ne retirait pas les serveurs des autres couches. Aucun réglage global modifié et aucune approbation automatique globale ajoutée. Les valeurs bridge restent en env, les arguments ne contiennent que leurs noms.

Fichiers L05 : packages/providers/src/codex.ts ; tests/providers/codex.test.ts ; tests/fixtures/providers/codex-cli.mjs ; scripts/live-codex.mjs ; docs/providers/codex.md. La fixture MCP partagée a reçu ses annotations diagnostiques sur transfert explicite. Aucun manifest, lockfile, contrat, index d'export ni changelog partagé modifié par L05.

## Critères

| Critère | Résultat | Preuve |
| --- | --- | --- |
| AC-L05-01 Normalisation | Satisfait | 10 tests Codex, sessions/outils/usage/erreurs réels, warnings de démarrage conservés |
| AC-L05-02 Concurrence | Satisfait | Deux CLI simultanées puis deux reprises simultanées, notes et IDs sans mélange |
| AC-L05-03 Reprise ciblée | Satisfait | Nouvelle ligne réelle dans proof.txt sur le même UUID ; ALPHA/DELTA_A et BETA/DELTA_B propres à chaque session |
| AC-L05-04 Arrêt | Satisfait | sleep 30 observé, SIGINT et résultat faux, puis même UUID récupéré avec recovered.txt |
| AC-L05-05 Preuve réelle | Satisfait | Modifications copiées/SHA256, MCP tools/call réel, token_present:true et refus natif contrôlé |

## Vérifications exécutées sur la révision finale

| Commande | Résultat | Preuve |
| --- | --- | --- |
| npm run check | exit 0 : types, format, build, 34/34 tests | native-check-final.log |
| npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js' | exit 0 : 34/34 | native-node24-final.log |
| git diff --check 4767e10e03806309bc629d4dc1e65cedc0604f0a HEAD | exit 0 | native-diff-final.log |
| node scripts/live-codex.mjs /Users/zeldris/avity-crew/avity-crew-workpack/validation/L05/native-single-final.json single | exit 0 : 5 tours séquentiels | native-single-final.json, native-single-final-command.log |
| node scripts/live-codex.mjs /Users/zeldris/avity-crew/avity-crew-workpack/validation/L05/native-parallel.json parallel | exit 0 : 4 tours, deux CLI maximum | native-parallel.json, native-parallel-command.log |

Après exécution, les cinq SHA256 et les champs de sessions/résultats ont été revérifiés par lecture programmée. Tous les événements identifiés appartiennent au bon UUID. Les quatre résultats concurrentiels sont success:true ; aucun ALPHA/DELTA_A chez B ou BETA/DELTA_B chez A. Les UUID restent exacts avec bridge PORT=1, privé dans les textes.

## Sessions finales

| Scénario | UUID natif | success adaptateur | exit CLI | sandbox/approval |
| --- | --- | --- | --- | --- |
| edit-and-mcp | 01a16de8-c164-7912-bf61-68e8dfb22177 | true | 0 | workspace-write/never |
| resume-new-note | 01a16de8-c164-7912-bf61-68e8dfb22177 | true | 0 | workspace-write/never |
| interrupt | 01a16de9-0d35-7fc2-a8ff-ffdae389ddf3 | false | 1 | workspace-write/never |
| resume-interrupted | 01a16de9-0d35-7fc2-a8ff-ffdae389ddf3 | true | 0 | workspace-write/never |
| permission-mcp | 01a16de9-53c9-7092-b240-30368263e17b | false | 0 | read-only/never |
| parallel-b | 01a16de4-6ad3-7b01-a7a5-c47fc7fb11b8 | true | 0 | workspace-write/never |
| parallel-a | 01a16de4-6abd-7c01-9cd9-fc7e68be4dbe | true | 0 | workspace-write/never |
| parallel-resume-b | 01a16de4-6ad3-7b01-a7a5-c47fc7fb11b8 | true | 0 | workspace-write/never |
| parallel-resume-a | 01a16de4-6abd-7c01-9cd9-fc7e68be4dbe | true | 0 | workspace-write/never |

Le refus final configure uniquement en recette crew.ping approval_mode=prompt sous policy never, en réutilisant les arguments du producteur. Le véritable item MCP failed devient permission/error ; la CLI sort 0 mais l'adaptateur renvoie false. L'audit contient tools/list et aucun tools/call refusé. Le ping positif a produit token_present:true ; la sentinelle d'accès n'apparaît pas dans le rapport.

## Copies réelles et persistantes

Le scratch context-mode est nettoyé par l'hôte. Les fichiers ci-dessous ont été copiés pendant leur existence puis leurs SHA256 recalculés après la recette.

| Copie canonique dans validation/L05 | SHA256 |
| --- | --- |
| native-single-final-proof-first.txt | 75ababf0104a69a803881a10e4ee00bbbfdc06ff0bc201b279db66bfbc22b4b3 |
| native-single-final-mcp-audit.jsonl | 77f86f04cc88c383b81f40a15a53647b37f1442ab5793eb5c652380926708dc0 |
| native-single-final-proof-resumed.txt | 2970ee1c9d88d598bee89457a409cfca9c45a951679e6e16eea0e04b2978727d |
| native-single-final-recovered.txt | 2197338f7a0600b495bf402df6d7b71759c9509bc6b7a400bf209f06a38cf873 |
| native-single-final-permission-audit.jsonl | 9843b1ae8011db0204eec5fae6cd14e277111006db00d964f23f15478a3cef63 |

## Usage disponible

| Tour | input_tokens | output_tokens |
| --- | --- | --- |
| edit-and-mcp | 95040 | 217 |
| resume-new-note | 145486 | 330 |
| interrupt | indisponible | indisponible |
| resume-interrupted | 72931 | 398 |
| permission-mcp | 69005 | 196 |
| parallel-b | 23294 | 75 |
| parallel-a | 23294 | 64 |
| parallel-resume-b | 47775 | 140 |
| parallel-resume-a | 47764 | 137 |

## Corrections et diagnostics conservés

- Le mode initial --ignore-user-config était une isolation de recette, pas le comportement produit final. Les anciens report.md/handoff.json, live-single/live-parallel et leurs copies restent conservés séparément. config-review.md et config-scope-probe.md expliquent le changement de décision et les sondes natives filtrées aux compteurs.
- Native 0.163.0 émet deux avertissements de démarrage via stdout item.completed/error, champs id/type/message sans severity/level/fatal : configuration ignorée et features en développement. Le premier run natif 9054113 était faussement marqué en erreur (native-single-initial-warnings.json). La forme est prouvée dans native-warning-shape-probe.json ; la régression échoue avant fix (native-warnings-before.log), puis passe (native-warnings-after.log). Seuls ces deux préfixes dans cette enveloppe deviennent unknown visibles. Les autres erreurs, error top-level, turn.failed, quota/auth/permission/réseau/protocole restent fatals. Warning avec exit non nul ou terminal absent échoue. Les neuf tours finaux gardent leurs diagnostics ; rien n'est modifié dans la configuration personnelle.
- Le nonce de comparaison de recette remplace 1 par x pour ne pas chevaucher PORT=1, privé. Il ne s'agit pas d'un UUID de protocole. Le SINGLE final a été rejoué sur le commit exact, et non transféré depuis d5e07c1 ; native-source-equivalence.json conserve aussi la comparaison historique.
- Les correctifs partagés b24a2ce et d229058 sont présents via 4f2499a et 4b95a32. La revue indépendante shared-redaction-review.md a reproduit puis clos la fuite CREW_HANDLE : toutes les valeurs bridge restent privées, les identités natives restent exactes. L05 n'a pas modifié process.ts.
- Les anciennes sondes de refus fichier ne contenaient que des déclarations du modèle sans événements outils ; elles ne sont jamais comptées comme une preuve de refus natif. Le refus MCP final est réellement observé.

## Limites et suite

NON EXÉCUTÉ : refus réel d'écriture fichier en read-only, pannes réelles quota/auth/réseau, autre modèle explicite accessible, autres versions Codex, Linux/Windows, CI distante et frontière HTTP/MCP L07. Les tests hors ligne couvrent les erreurs et arguments correspondants. Le modèle effectif et le coût monétaire sont indisponibles. L'arrêt d'arbre est garanti/testé POSIX ; limite Windows du runner partagée.

Le préflight suppose la configuration native stable entre sa lecture et le lancement. Les noms MCP acceptés sont ASCII lettres/chiffres/_/-. L07 devra donner aux outils mutants une politique native étroite explicitement autorisée et des ACL de service. La fin de tour provider ne vaut pas livraison acceptée.

Intégration : après les originaux partagés L04/root (5bc6ebe, f863a5b, 48e7f33, b24a2ce, d229058), commits propres L05 : 6de52f1, 09167f4, 3e7f48d, 0c9c793, f1d594a, 9054113, d5e07c1, 7fb39c6. Ne pas reprendre les doublons partagés locaux. Le coordinateur possède export CodexProvider, revue indépendante, intégration, changelog et vérification de la combinaison finale.

Aucune mémoire Serena écrite hors scope ; décisions durables proposées : exec JSONL, reprise UUID exacte avec nouveau stdin, consommation events+result, préflight MCP natif par run et expurgation des textes distincte des identités. Ne pas stocker durablement sessions, jetons ou logs transitoires.
