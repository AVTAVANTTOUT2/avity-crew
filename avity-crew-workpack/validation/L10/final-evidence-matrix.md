# L10 — matrice de preuve de reprise

Révision examinée et testée : `ccbab6f1551c2f54056bece878b229377f1ef52f`. Relecteur : `l00_provider_audit`. Cette matrice distingue les invariants prouvés et les extensions natives non exécutées ; elle n'invente pas de passation L10 ni d'acceptation globale.

| Critère | Preuve constatée |
| --- | --- |
| AC-L10-01 | Service/viewer séparés, reconnexion et curseur, conservation du run/tasks ; tests CLI/PTY et clients HTTP réels. |
| AC-L10-02 | Coupures déterministes, snapshots Git immuables, tentatives interrompues et opérations réconciliées ; tests réels POSIX refusant identités ambiguës et groupes non possédés. |
| AC-L10-03 | Reçu idempotent, capture conservée et intégration CAS ; rejeu après perte de réponse et transactions interrompues testés. Révocation pendant attente/préparation/promotion désormais refusée sans faux effet accepté. |
| AC-L10-04 | Ancienne génération/tentative/passation refusée après amendement ou réattribution ; tous anciens writers doivent être observés arrêtés. |
| AC-L10-05 | Factory du chef configurable, nouvelle génération, décisions/contexte/dependances durables et ancienne capacité révoquée. Tests de remplacement et source vérifiés ; **passage natif Claude↔Codex en rôle chef sur le même objectif non observé dans la recette documentaire**. Ne pas le présenter comme un succès live. |
| AC-L10-06 | Erreurs normalisées auth/quota/permission → attente explicite et reprise autorisée ; aucun succès inventé ni basculement implicite. Refus de permission natif enregistré dans le run historique ; les quotas restent couverts par source/fixtures. |
| AC-L10-07 | Contexte versionné/hashé, sources et décisions conservées ; reprise exacte de session quand supportée, sinon NATIVE_RESUME_UNAVAILABLE impose une décision explicite. Prompts et inspections sauvegardés relus après plus de 200 événements ; required_source d'instruction préservé après remplacement de racine. |

## Niveau de preuve

Les invariants ci-dessus sont couverts par source et tests déterministes avec stockage, Git, transport et processus réels. Les tests de remplacement utilisent des frontières fournisseur simulées : leur provenance n'est pas un passage natif entre moteurs. Le [run documentaire natif](../L07/native-doc-claude-report.json) complète la preuve par des continuations Claude avec UUID exact réutilisé, permissions refusées, remplacement explicite d'un chef dont l'ancien UUID n'était pas reprenable, et revue Codex distincte. Le chef de ce rapport demeure Claude : aucune inversion native n'en est déduite.

Sur ce SHA propre, le relecteur a rejoué `npm run check` Node26 puis la suite Node24.22.1 : **177/177 chacun, zéro skip**. Aucun fournisseur lancé par le relecteur. Les refus MCP natifs du paquet exact sont consignés par le coordinateur dans [final-checks.md](../L07/final-checks.md), sans convertir l'essai Codex autorisé en preuve de refus.

## Limites et clôture

Aucun défaut source restant confirmé dans les mécanismes L10 relus. Cette revue constate la couverture d'implémentation/invariants et le complément live borné permis par la fiche L10 ; elle ne vaut pas qualification native finale de toutes les permutations de fournisseur. La reprise inverse-chief sur le paquet final et les autres parcours applicatifs relèvent encore de la recette coordonnée ; AC-L08-02 reste bloquant pour le lot précédent. Windows est explicitement non supporté pour ces garanties de processus ; Linux/WSL et CI distante non exécutés. Les descendants quittant volontairement leur groupe POSIX et les ambiguïtés PID restent refusés/documentés, pas déclarés arrêtés.

Aucun nettoyage destructeur, scan global, code ou état de coordination modifié. Aucun futur handoff_id inventé.

