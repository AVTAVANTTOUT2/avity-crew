# Restant L07–L12 avant clôture

Source lue : **76fe256af8b9c7b58d705acf46f1c18f7df52b9c**, 24 octobre 2026. Lots L07–L12 et docs/ACCEPTANCE.md E2E-01 à 12. Lecture seule : aucun test, modèle, paquet ou sous-agent lancé ; aucun statut changé.

**Socle disponible :** le coordinateur rapporte 151/151 tests Node 26/24 et 11 E2E runtime. Les sources confirment neuf scénarios + deux variantes de reprise refusée. Les décisions fournisseur sont scriptées ; HTTP, SQLite, Git, captures et certains processus OS sont réels. Ces preuves ne sont pas une équipe LLM native.

**Live en cours, constat reçu du coordinateur :** document écrit/capturé, SHA et preuve statique, reviewer Codex accepté ; chief Claude poursuit acceptation/clôture. Archiver le résultat final avant de classer ce run passé. Ce rapport ne le déclare pas terminé.

## Couverture et reste concret

Les fichiers de tests cités sont sous tests/ du dépôt, sur la source ci-dessus. Les compléments demandés sont des preuves de recette ; ils ne supposent pas systématiquement de nouveaux mécanismes.

| E2E / critères | Preuve existante | Reste avant clôture |
| --- | --- | --- |
| 01 application — L08-01/02, L11-01/03 | runtime.test.ts:1072 : deux writers simulés, chevauchement, vrais worktrees et promotion relue. | Dossier vide → application utilisable, deux missions utiles ; **chef + deux exécutants mixtes Claude/Codex réellement simultanés**, puis résultat réuni vérifié. Writer/reviewer séquentiels ne prouvent pas ce jalon. |
| 02 existant — L11-02 | examples/transport-scenario.md est une spécification, pas une recette chauffeur exécutée. | Fixture isolée : décisions retenues, serveur/interface/persistance, droits, conflit concurrent et non-régression sur la combinaison. |
| 03 chefs — L07-06, L08-04, L11-03 | APIs communes ; remplacement simulé runtime.test.ts:1741 ; live Claude/reviewer Codex partiel. | Même parcours sur candidat final avec Claude chef + Codex exécutant, puis inverse ; mutations et résultats réels, sans adapter le domaine. |
| 04 correction — L08-03/05, L11-07 | runtime.test.ts:1360 : changes_requested, stratégie, nouvelle tentative/preuves, acceptation. | Rattacher la boucle à une recette produit avec défaut observable et clôture refusée avant correction. Un incident corrigé manuellement pendant le chantier ne suffit pas. |
| 05 contexte — L08-01/03, L10-07 | context.test.ts : versions modifiées/supprimées, ciblage, prompt exact ; runtime.test.ts:867 : réponse/source/décision. | Trace d'un contrat/d'une décision changé pendant un run et reçu uniquement par les missions concernées. |
| 06 reprise — L07-01/04/05, L09-03/05, L10-01 à 05/07 | runtime.test.ts:1741,1954,2035 : révocation, reprise explicite et identités refusées ; reconciliation.test.ts : vrais groupes POSIX ; cli.test.ts : reconnexion/PTY. | Parcours livré : détacher/rattacher, interrompre/reprendre une session native, redémarrer après intention, remplacer le chef en conservant graphe/décisions, rejeter ancienne tentative sans double effet. |
| 07 charge — L07-05, L11-04 | Configuration 7 ; scheduler.test.ts mesure pic global **3**, par run **2**. Son test construit à 7 n'occupe qu'une place. | Recette légère du plafond sept, chef compris, ressources/routage mesurés. **Sept CLI réellement actives non vérifiées.** La charge intensive peut être simulée selon ACCEPTANCE, avec maximum natif observé et limites séparés ; la configuration seule ne prouve rien. |
| 08 erreurs/question — L07-03/05, L10-06 | Fixtures provider quota/refus ; question HTTP/SQLite runtime.test.ts:867 ; ACL et provenance dans supervisor-transport/coordination-state.test.ts. | Quota/refus simulés → attente visible, tâche indépendante, reprise ; diagnostic et permission contrôlée sur chaque provider réel du candidat final. Aucun vrai dépassement de quota à provoquer. |
| 09 combinaison — L08-03/05, L11-07 | workspace.test.ts : deux changements isolément verts échouent réunis, stable préservée ; correction après revue séparément couverte au runtime. | Un parcours reliant candidat invalide → mission corrective → preuves du **nouveau** candidat. |
| 10 installation — L09-01/02/06, L12-01 à 06 | CLI cwd distinct/espace et PTY sur fixtures ; README rapporte ancien smoke tarball help/init/status/arrêt sans objectif/modèle. | **Requalifier le paquet final** : contenu/SHA, préfixe propre, binaire installé, objectif fonctionnel et deux projets isolés dont un avec espaces ; mise à jour depuis base antérieure, arrêt/reprise et désinstallation conservant les données. |
| 11 document — L08-07, L11-08 | runtime.test.ts:524 : document_paths, capture, revue indépendante, inspection command:null, acceptation/clôture sans Git ; observations natives partielles actuelles. | Archiver la chaîne native complète : document/SHA, revue, preuves, accept_delivery puis résultat final. Le seul statut accepté du reviewer ne clôt pas le run. |
| 12 une place — L08-06 | Premier runtime E2E + scheduler.test.ts : délégation non bloquante, libération, worker, reprise chef ; pic ≤1 simulé. | Recette documentaire native à une place prête : conserver les intervalles de tours actifs chef compris et la clôture, pas seulement compter les sessions connues. |

## Priorités root

1. Finir honnêtement le live courant, puis **figer un candidat final C**. Chefs inverses, parallélisme mixte et document max1 doivent référencer C. Les essais L05 sur **7fb39c6** et autres recettes d'anciennes sources ne qualifient pas L11/L12 sur C.
2. Combler les parcours produit du tableau, surtout nouvelle application/fixture chauffeur, correction de combinaison et incidents. Mesurer la charge revendiquée ; garder tout écart de capacité explicitement ouvert.
3. Même C pour checks Node24/26, rapport final, paquet installé/SHA et documentation. README décrit encore 4c003ca, 125/143 tests et le contrat de passation en correction : actualiser après recette. CI check/pack est configurée dans .github/workflows/check.yml ; aucune exécution distante établie ici.

## Limites à conserver

- **Après init : configuration limitée.** docs/INSTALLATION.md:132 et Store/index.ts:145 conservent la configuration du premier enregistrement. Pas de commande de rafraîchissement ; modifier le fichier puis redémarrer ne recharge pas ses réglages. Préparer le fichier complet avant init/doctor/service. Les choix de run restent distincts et bornés par la capacité persistée ; custom suit workspace. Ne pas supprimer la base pour contourner cela ; ce n'est pas un nouveau chantier requis pour cette cartographie.
- **Plateformes/reprise :** macOS observé ; Linux/WSL restent à qualifier ou not_verified. Windows natif n'a pas la garantie d'arbre POSIX. ps a une précision de naissance d'une seconde et une course observation/signal ; leader absent avec orphelins → RECONCILIATION_REQUIRED (docs/RECOVERY.md), jamais réattribution sur silence.
- **Routes historiques :** validation/L07/transport-checks.md, validation/L07/runtime-review-final.md, validation/L08/test-design.md et validation/L09/cli-checks.md portent d'autres révisions/portées. Elles guident la recette sans l'accepter. Registre lu : L07 in_progress, L08–L12 todo ; ce document ne les modifie pas et ne nie pas le code déjà réalisé.

Le rapport final doit lier commit, commandes/environnement, versions CLI, modèles demandés/effectifs seulement si exposés, permissions, sessions et preuves filtrées. Aucune publication de registre ou opération de production n'est requise par cette recette locale.
