# L08 — matrice de preuve au candidat final

Révision examinée et testée : `ccbab6f1551c2f54056bece878b229377f1ef52f`. Relecteur : `l00_provider_audit`. **L08 reste en attente : AC-L08-02 manque une preuve native obligatoire.** Cette matrice ne constitue pas une soumission d'acceptation.

| Critère | Niveau constaté | Conclusion |
| --- | --- | --- |
| AC-L08-01 | Source + tests contexte/runtime | Brief, objectif, scope, critères, décisions, références et permissions ciblées ; critères complets et prompt exact inspectable. Couvert. |
| AC-L08-02 | Parallélisme Git/processus simulé ; natif documentaire séquentiel | **BLOQUANT : deux exécutants mixtes réellement simultanés non démontrés.** Le run applicatif C71 a été annulé avant lancement des workers après le défaut de source, désormais corrigé/testé. |
| AC-L08-03 | Tests runtime/Git + amendements natifs documentaires | Refus de revue/candidat combiné en échec → correction décidée, nouvelle tentative, contrôles et revue courants requis. Couvert au niveau déterministe ; ne pas prétendre à une recette applicative native finale. |
| AC-L08-04 | Source configurable + adaptateurs qualifiés + fixtures | Le fournisseur du chef ne change pas le modèle de données. Le parcours final inverse-chief reste à qualifier nativement. |
| AC-L08-05 | Store/proofs canoniques et tests négatifs | Critères globaux immuables, preuves de tentative/révision courantes ; aucun succès natif seul ne ferme le run. Couvert. |
| AC-L08-06 | Test strict max=1 + complément natif documentaire borné | Délégation non bloquante et alternance chef/worker ; pic déterministe=1. Le rapport natif compte seulement ses intervalles complets. Couvert avec cette limite de mesure explicite. |
| AC-L08-07 | HTTP/SQLite + run documentaire natif completed | Document sans Git, empreinte serveur, reviewer distinct, accept_delivery et finish_run observés. Hash du fichier matérialisé vérifié indépendamment. Couvert comme recette historique, pas comme preuve finale du paquet. |

## Vérifications

Sur ce SHA propre : `npm run check` Node26 et suite complète Node24.22.1 rejoués indépendamment : **177/177 chacun, zéro skip**. Aucun LLM lancé par le relecteur. [Revue Store/intégration](plan-integration-review.md) et [revue finale runtime L07](../L07/final-runtime-review.md).

Le test de charge à sept utilise des fournisseurs simulés et de vrais processus locaux. Il prouve les invariants de capacité et ressources, **pas AC-L08-02 natif**. Le rapport documentaire mélange réellement Claude/Codex, mais max=1/peak=1 ; il ne satisfait pas la simultanéité demandée.

**Action requise avant acceptation L08 :** recette sur le candidat/paquet identifié, chef et deux exécutants mixtes sur travaux indépendants, chevauchement constaté, livraisons réunies, contrôles/revue et fin justifiée. Conserver objectif, IDs natifs, intervalles et preuves. Les scénarios L11 (fonctionnalité existante, charge native jusqu'à sept, qualification finale inverse-chief) restent leurs propres obligations ; ils ne permettent pas de déplacer ou supprimer AC-L08-02.

Aucun défaut source supplémentaire confirmé ; le blocage est une preuve requise absente. Aucun futur handoff_id inventé.

