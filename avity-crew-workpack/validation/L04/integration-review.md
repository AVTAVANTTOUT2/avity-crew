# L04 — Revue indépendante et intégration

Relecteur : codex-coordinator (session racine), différent de l'exécutant L04
`l04-claude` (`/root/l00_provider_audit`).

- Base d'intégration : `f5f50bd0415793b5b1656b9b5816fcb7764e7f0c`.
- Source L04 : `bb5ec87f157ccaae76277ce04058854927ac8182`.
- Candidat combiné : `b30b3301a826513ed706d248962df1baf44e8354`.
- Passation : `handoff-4d03c0896b324ca7ba5a018fa7e378a5`.

Revue du runner et de l'adaptateur : spawn argv/stdin sans shell, flux UTF-8 et
JSONL bornés, backpressure, séparation stderr/protocole, expurgation des capacités,
identité native attendue en reprise, interruption de groupe POSIX avec escalade,
refus explicite de send, résultat final conditionné au résultat natif ET à la
sortie sans interruption/erreur. Les refus natifs Claude deviennent des erreurs
de permission même lorsque le processus sort avec le code 0.

L'export public ClaudeProvider a été ajouté par l'intégrateur. `npm run check`
sur cette combinaison : exit 0, typage/format/build et 38/38 tests (12 contrats,
13 stockage et 13 providers). Aucun finding L04 restant observé.

Le rapport `claude-live-report.json` a été examiné : six scénarios réels réussis
sur la source L04 avec Claude Code 2.1.304, édition de fichier contrôlée, appel
MCP observé, session d094e6df-b621-4d4b-a8b0-86918d460c24 reprise précisément,
seconde session distincte, frontière Read-only, refus natif et interruption avec
success=false. Les contrôles live ont été exécutés par l'auteur L04 ; le
relecteur ne les présente pas comme rejoués sur la combinaison. La future recette
L07/L11 exercera les outils complets sur la version intégrée.

Limites visibles : runtime live macOS arm64 seulement ; pas de deux Claude
simultanés, de quota réel provoqué ni de modèle effectif archivé pour cet essai.
L'entrée pendant un tour est unsupported ; le superviseur doit conserver les
messages et reprendre une session précise. Le profil Read-only limite les outils
natifs disponibles, pas une isolation hostile de tout le système. L'acceptation
de L04 ne valide ni le lot stockage encore en correction ni la boucle produit.
