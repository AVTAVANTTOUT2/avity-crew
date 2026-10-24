# Incidents conservés de la recette de développement

- Run050e045a sur paquet c71b313 : instruction AGENTS requise reconnue par le chef, provenance perdue dans le worktree exécutant ; annulé avant exécution des auteurs. Correctif ccbab6f et régression deux vrais worktrees, sans retrait de source obligatoire.
- Run49d968f4 sur paquets ccbab6f puis b0571ad : deux auteurs natifs mixtes démarrés, pause avec fichiers préservés, redémarrage et remplacement de chef observés ; la livraison finale d'une mission reprise ne contenait que le dernier delta. Le candidat a échoué sans acceptation. Correctif acaa22c et quatre régressions Git cumulatives. Les décisions de contournement anciennes ont ensuite produit une capture incertaine avant claim ; le scheduler réenfilait la délégation. Correctif80e3930, régression et probe indépendant.

Ces runs sont annulés, leurs fichiers, décisions, snapshots, candidats en échec et événements restent conservés. Ils ne sont pas comptés comme recettes applicatives réussies. Aucun ancien artefact ou échec n'a été réécrit en succès.

La recette propre recommence depuis le paquet537d3c4 et un dépôt indépendant contenant uniquement les entrées de recette (contrat, test, configuration), sans code applicatif ni anciennes décisions. Le rapport final doit citer ce nouveau run séparément.
