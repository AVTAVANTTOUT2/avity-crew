# Revue ciblée — livraison cumulative après reprise

**Révision finale :** `acaa22c3e71cf9f5b98c5d4edfad118aa301ccae`, avec les régressions Git `e3ca42ecc88a37c02c6ae99c5fbf35c739d0a15e`.

**Conclusion : correctif cohérent, aucun blocage restant confirmé dans le périmètre de collecte.** La base du workspace indique où reprendre le travail ; la base courante de la TaskSpec indique le delta que la mission doit livrer. Les deux ne sont pas interchangeables.

## Cas vérifiés

Soit B la base assignée, P le snapshot partiel de la tentative interrompue et S la livraison suivante. Le second workspace continue depuis P, mais S doit avoir **B comme parent**, annoncer `delivery.baseRevision=B` et contenir le cumul B→S. Cherry-pick de ce snapshot sur B conserve alors les fichiers des deux tentatives.

Le diff utilise bien la même base de TaskSpec pour la métadonnée de livraison, les deux calculs de chemins avant capture, le parent de `commit-tree` et le diff final. Le workspace et son historique de départ P ne sont pas réécrits.

| Cas | Résultat attendu et constaté |
| --- | --- |
| Tentative normale, workspace B / tâche B | Parent et delta restent B ; comportement normal inchangé |
| Reprise, workspace P descendant de B / tâche B | Snapshot cumulatif parent B ; fichiers de la première et de la seconde tentative présents dans le candidat réellement préparé sur B |
| Scope rétréci après arrêt des writers | Le fichier antérieur hors du nouveau périmètre provoque `OUTSIDE_SCOPE`, même si la seconde tentative ne l'a pas modifié |
| Exclusion ajoutée sur un fichier antérieur | Refus sur le cumul ; régression Git intégrée verte |
| Base amendée vers X absente de l'historique de départ du workspace | `BASE_CHANGED` avant collecte/staging ; une ancienne arborescence n'est pas présentée comme construite depuis X |
| Base de tâche nulle en code | `BASE_REQUIRED` ; aucun fallback ambigu vers P |
| Documentation | Branche de capture documentaire inchangée, `baseRevision:null`, empreintes de fichiers ; les tests existants passent |

## Garde minimale

Le contrôle `merge-base --is-ancestor(taskBase, workspaceBase)` est pertinent et conservateur : égalité et ancêtre B→P sont permis ; une nouvelle base incompatible impose une nouvelle attribution depuis cette base. **Ce contrôle ne réalise pas un rebase.** Le scope demandé et le scope courant de la TaskSpec sont ensuite vérifiés sur tous les changements cumulés, avant staging et après construction du snapshot.

Le refus d'une base nulle en code est volontairement plus strict que l'inférence depuis le seul WorkspaceHandle : les appelants de collecte de code doivent conserver une base assignée explicite. Le mode documentaire reste distinct. Aucun garde additionnel n'est nécessaire pour les cas de collecte examinés.

## Preuves exécutées

- Probe indépendant avec Store et Git réels sur le diff final avant ajout du seul commentaire explicatif (SHA-256 du diff : `f03d50a4bf3310bc528f905f2f64bd5b7dba08ff35d18cc1520ed87c248e1555`). Le JS compilé correspondait au source relu.
- Le probe observe : workspace2.base=P ; livraison2.base=B ; parent(S)=B ; `changedPaths` contient les deux fichiers ; candidat `validated` sur B avec les deux fichiers présents. Scope réduit → `OUTSIDE_SCOPE` ; base incompatible → `BASE_CHANGED` ; base nulle → `BASE_REQUIRED`. Les fichiers des tentatives restent conservés.
- Sur **acaa22c**, `node --test dist/tests/workspace.test.js`, Node **26.12.0** : **19/19 réussis, zéro skip, exit 0**, y compris les quatre nouvelles régressions de reprise/scope/exclusion/base amendée.
- Le coordinateur annonce `npm run check` **181/181** ; cette commande globale n'a pas été rejouée par ce relecteur pour cette revue. Node 24 global et nouveau paquet restent à son étape suivante.

Aucun LLM, CLI fournisseur, code produit ni test persistant modifié par ce relecteur ; seuls ce rapport et des fixtures temporaires nettoyées ont été écrits. Aucun processus extérieur n'est signalé.

## Reprise du run natif

L'ancien candidat échoué et les anciens snapshots restent des observations immuables ; le correctif ne les transforme pas rétroactivement en livraison cumulative. Le run 49d reste en pause. Sa reprise doit produire **une nouvelle tentative et une nouvelle livraison cumulative**, puis un nouveau candidat, ses contrôles et sa revue, sans réécrire l'ancienne opération. Aucune réussite native après correctif n'est revendiquée ici.
