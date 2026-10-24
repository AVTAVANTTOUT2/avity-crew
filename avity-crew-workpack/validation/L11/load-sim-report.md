# L11 — Charge sept places, preuve SIM uniquement

Source vérifiée exactement : git:b6cbf2a7c49878461e7d65412323fc561937e855. Test original : git:833a534fe9bd04f9a766479d40f80cbee616e91e, intégré par le coordinateur ; tests/load.test.ts et tests/fixtures/load/session.mjs ont été comparés octet pour octet à ce commit, sans modification des assertions. Aucun code produit écrit dans cette mission.

**Niveau : simulation de fournisseur avec vrai Runtime/Scheduler, HTTP authentifié, SQLite, Git/worktrees, sockets et processus Node POSIX. Zéro CLI LLM lancée par le banc. Cette preuve n'annonce ni sept CLI Claude/Codex simultanées, ni un objectif métier accepté, ni la clôture L11/L12.**

## Résultats exécutés

| Contrôle | Résultat |
| --- | --- |
| npm run check, Node v26.12.0 | types/format/build et 170/170 tests, exit 0 |
| npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js' | Node v24.22.1, 170/170 tests, exit 0 |
| Charge mesurée, dans chacune des deux suites | capacité configurée 7, pic ProviderProcess/OS 7, pic Scheduler 7, sept workspaces workers |
| Fin du scénario | paused, aucun Handoff/acceptation fabriqué, business_completed:false |
| Nettoyage observé après les suites | 0 processus actifs de la fixture, 0 répertoires de laboratoire restants |

Hôte : darwin/arm64, noyau 25.5.0. Exécuté sur macOS POSIX uniquement ; Windows est exclu explicitement du test. Linux/WSL non exécutés dans cette preuve. Les décisions et tous les événements/résultats fournisseur portent provenance:simulated ; aucune identité de modèle, coût ou usage LLM n'est inventé.

## Ce que le banc constate

1. Un vrai enfant Node chef authentifié par les variables ENV de sa capacité crée sept TaskSpec indépendantes puis reçoit les sept réponses delegate_task pendant que son tour demeure actif à une barrière. Six vrais enfants workers écrivent chacun dans son worktree, publient note et message par SupervisorClient/HTTP, puis restent actifs. Le septième worker est effectivement queued : sept places sont exercées, chef compris, sans appel de délégation bloquant.
2. Les sept PID vivants sont observés par ps avec groupe détaché propre. Chaque cohorte a six ports workers distincts réellement écoutés et sondés par échange TCP, le chef n'ayant pas besoin de port applicatif. La libération d'un worker est suivie de sa sortie OS avant le démarrage du queued ; huit processus sont utilisés sur la séquence, avec pic sept et aucun pic huit. Les ports peuvent légitimement être réutilisés après une sortie : la distinction vérifiée porte sur les propriétaires simultanés.
3. Sept cwd/worktrees, bases SQLite et répertoires temporaires sont distincts. Chaque enfant crée réellement une ligne SQLite et un marqueur temporaire portant son task_id. Les notes et messages ont l'auteur dérivé de la session, chaque vue worker ne voit que sa tâche et son propre message ; une publication sur une autre tâche reçoit FORBIDDEN. Aucun Actor libre n'est transmis.
4. Un exit réussi sans passation ne complète pas le run. Pause arrête les groupes observés, puis scheduler actif/queued valent zéro ; chaque PID est mort. Les fichiers des sept worktrees sont relus identiques après l'arrêt, la racine Git reste propre et son HEAD inchangé. Les laboratoires ne sont supprimés qu'ensuite par le cleanup du test. Ces fichiers sont des effets de fixture, pas une livraison business déclarée vérifiée.

## Régression mise au jour et correction

Le banc rouge sur le produit f0d0d077e1ed5464f9dc6e476403e6e349c39bf7 atteignait déjà sept places et leurs effets, puis reproduisait une relance indue d'un neuvième tour chef pendant pause. Son create_task dupliqué échouait INTERNAL_ERROR ; le test restait rouge. La trace est conservée dans load-sim-red.log.

Le coordinateur a corrigé Runtime dans b6cbf2a : suspending par run avant cancelQueued/interrupt, refus wake/pump/mayStart durant le contrôle et retrait après l'état observé ; contrôles concurrents refusés CONTROL_IN_PROGRESS. La source b6cbf2a complète a ensuite été chargée exactement dans le checkout isolé, puis vérifiée sur les deux Node. Aucun cast, délai arbitraire ou assertion assouplie n'a masqué le défaut.

Les journaux et métriques lisibles par machine sont dans load-sim-report.json, load-sim-node26.log, load-sim-node24.log et load-sim-cleanup.json. Le pic natif Claude/Codex reste une recette séparée du coordinateur ; cette preuve ne le remplace pas. Aucun statut de chantier modifié.
