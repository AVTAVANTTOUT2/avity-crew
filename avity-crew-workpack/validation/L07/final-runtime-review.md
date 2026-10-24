# L07 — revue finale des raccordements runtime

Révision : `ccbab6f1551c2f54056bece878b229377f1ef52f`. Passation : `handoff-b64a75d84a124114b18b95d0efa75b5d`. Relecteur : sous-agent `l00_provider_audit`, indépendant de l'auteur du runtime intégré.

**Aucun finding bloquant restant dans les raccordements/runtime examinés.** Je ne signe pas une revue indépendante de mon propre transport : cette partie est couverte séparément par [la revue de l05_codex](independent-transport-review.md). La CLI relève de sa revue L09 distincte.

La synthèse combine une indépendance répartie : **l05_codex** relit mon transport et [ma CLI](../L09/independent-cli-review.md), **l00_provider_audit** relit les raccordements/runtime/capabilities du coordinateur, et **acceptance_map** relit le contexte et sa régression d'instruction requise. Les 177 tests combinés portent sur le même SHA gelé. Cette répartition ne présente aucun auteur comme relecteur indépendant de ses propres modules.

| Critère | Preuve et conclusion |
| --- | --- |
| AC-L07-01 | Singleton, plusieurs clients et état partagé : tests HTTP/SQLite et double init réel de la revue transport ; raccord runtime conforme. |
| AC-L07-02 | Routage par run/tâche/tentative et états queued/delivered/acknowledged/applied distincts ; tests runtime/messages et scénario natif documentaire. |
| AC-L07-03 | Acteur issu du canal, rôles et générations contrôlés ; revalidation à dequeue et aux frontières async de lecture, capture, préparation et promotion. Régressions d'autorité vertes. |
| AC-L07-04 | Service distinct du viewer ; reconnexion/PTY et arrêt explicite testés, aucun arrêt d'agent associé au simple détachement de vue. |
| AC-L07-05 | Intentions, PID/session observés, attentes, interruptions et preuves séparés du succès natif ; erreurs et issues ambiguës restent visibles. |
| AC-L07-06 | Domaine commun aux adaptateurs. Le run documentaire natif historique contient Claude et Codex, séquentiellement ; les fixtures intégrées contrôlent leurs frontières. Aucune simultanéité native déduite. |

## Vérifications indépendantes sur cette révision

- `npm run check`, Node 26.12.0 : types, format, génération, build et **177/177 tests réussis**, zéro skip, exit 0.
- `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` : **177/177 réussis**, zéro skip, exit 0.
- HEAD identique avant/après, arbre produit propre. Aucun fournisseur lancé par le relecteur.

Les tests comprennent Git, SQLite, HTTP, MCP, processus POSIX et PTY réels ; leurs fournisseurs de test restent simulés. La charge à sept mesure des processus/slots simulés, pas sept LLM.

## Source, contexte et preuve native

Le diff depuis f0d comprend les gardes après révocation, la suspension des relances pendant pause/stop, les projections des passations courantes et des messages incrémentaux, et le refus explicite d'une reprise native non supportée. La projection 6c33 ne duplique plus les schémas MCP dans le prompt : noms/descriptions y restent, les schémas complets restent exposés par MCP. Les critères du run et de la TaskSpec assignée restent complets. Les détails de tâche/livraison et le prompt/inspection sauvegardés sont relisibles ; la recherche de l'événement context.compiled est paginée. Le correctif des instructions required_source et sa régression font partie des 177 tests.

Le [rapport natif documentaire](native-doc-claude-report.json) constate un run completed, Claude documenter/chef et Codex reviewer, une acceptation et un finish_run avec preuves. J'ai vérifié que le document actuel correspond à son empreinte de fichier et que le dossier n'a pas de .git. Ce rapport reste une recette de développement historique, avec changements de source entre continuations : il ne prouve pas le paquet applicatif final. Son peak=1 exclut un premier intervalle incomplet, explicitement listé ; je ne transforme pas cette mesure en preuve de charge native globale.

Les deux fenêtres d'autorité confirmées puis corrigées sont décrites dans [queued-authority-review.md](queued-authority-review.md). Aucun autre défaut concret confirmé dans cette revue bornée.

**Limites de portée :** la qualification native applicative simultanée/inverse-chief, les plateformes autres que macOS et la CI distante restent distinctes. L08 ne doit pas être clos sur cette seule revue. Aucun code ni registre modifié ; seules ces preuves de revue sont écrites.

