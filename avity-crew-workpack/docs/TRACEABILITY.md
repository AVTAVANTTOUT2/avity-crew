# Matrice de traçabilité — exigences, lots et preuves

## Usage

Cette matrice décrit **ce qu’il reste à construire** et comment l’accepter. Aucun scénario de produit n’a été exécuté par la création de ce dossier. Les critères `AC-Lxx-yy` sont définis dans les fichiers des lots liés ci-dessous ; ils ne sont pas des noms de tests déjà implémentés.

Le coordinateur conserve cette table comme référence, puis ajoute les liens vers les preuves réellement produites, leur révision et leur provenance. Un résultat simulé valide son périmètre technique ; il ne certifie pas une intégration fournisseur réelle ou une plateforme non essayée. Tous les critères du lot restent applicables ; les renvois ci-dessous mettent en évidence leurs liens avec les exigences et ne réduisent pas la recette.

Les scripts de `../scripts/` gèrent le **chantier de construction**. La V1 doit fournir son propre runtime, ses contrats exécutables et ses vérifications. Les scénarios Avity Transport sont des fixtures hypothétiques, sans intervention sur une production.

## Couverture obligatoire de la V1

| ID | Exigence vérifiable | Lots responsables | Critères / preuves attendues |
|---|---|---|---|
| **R01** | Lancer `avity-crew` depuis un projet indépendant du répertoire d’installation ; conserver des contextes distincts. | [L00](../lots/L00-audit.md), [L09](../lots/L09-cli-tui.md), [L12](../lots/L12-release.md) | AC-L00-01, AC-L09-01, AC-L12-02/03 : lancement du paquet installé depuis deux projets, dont un chemin avec espaces. |
| **R02** | Traiter un objectif générique : création, feature, correction ou autre mission à livrable défini. | [L08](../lots/L08-orchestration.md), [L11](../lots/L11-recette-documentation.md) | AC-L08-01/05, AC-L08-07, AC-L11-01/02, AC-L11-08 : projet nouveau, feature existante et document sans Git, avec critères et livraison. |
| **R03** | Construire une connaissance du dépôt sourcée, actualisable et distincte des hypothèses. | [L03](../lots/L03-contexte-prompts.md) | AC-L03-01/02/03 : carte du projet, changement de contrat, invalidation et provenance des références. |
| **R04** | Fournir les bons prompts et le bon contexte à chaque mission, avec instructions stables et mises à jour séparées. | [L03](../lots/L03-contexte-prompts.md), [L08](../lots/L08-orchestration.md) | AC-L03-01/03/05, AC-L08-01 : inspection de deux briefs distincts et démonstration de conservation des critères sous budget. |
| **R05** | Utiliser Claude Code ou Codex comme chef ; transmettre la conduite sans perdre l’objectif. | [L04](../lots/L04-claude.md), [L05](../lots/L05-codex.md), [L08](../lots/L08-orchestration.md), [L10](../lots/L10-reprise-resilience.md) | AC-L08-04, AC-L10-05 : lancement avec chacun des chefs et passation conservant décisions, tâches et dépendances. |
| **R06** | Employer des sessions locales Claude et Codex réelles et mixtes, avec leurs capacités détectées. | [L04](../lots/L04-claude.md), [L05](../lots/L05-codex.md), [L07](../lots/L07-superviseur-outils.md), [L11](../lots/L11-recette-documentation.md) | AC-L04-05, AC-L05-05, AC-L07-06, AC-L11-03 : versions, session IDs, modifications observées et traces filtrées d’un run réel. |
| **R07** | Découper en tâches dépendantes, lancer le travail prêt et exploiter les retours pour poursuivre. | [L02](../lots/L02-etat-persistant.md), [L08](../lots/L08-orchestration.md) | AC-L02-01/03, AC-L08-01/02/03 : dépendance bloquante, parallélisme réel et mission corrective produite après revue. |
| **R08** | Échanger des notes, questions et décisions ciblées, avec trace de leur transmission et de leur prise en compte. | [L02](../lots/L02-etat-persistant.md), [L03](../lots/L03-contexte-prompts.md), [L07](../lots/L07-superviseur-outils.md) | AC-L02-06, AC-L03-02, AC-L07-02 : note publiée puis transmise au bon destinataire ; aucune lecture supposée. |
| **R09** | Exiger des passations complètes et produire une documentation fondée sur le résultat obtenu. | [L01](../lots/L01-socle-contrats.md), [L08](../lots/L08-orchestration.md), [L11](../lots/L11-recette-documentation.md) | AC-L01-03, AC-L08-05, AC-L11-06 : livraison incomplète refusée, rapport sourcé et documentation conforme à la révision. |
| **R10** | Séparer les modifications, attribuer les ressources et intégrer une combinaison vérifiée. | [L06](../lots/L06-workspaces-git.md) | AC-L06-01/02/03/04/05/06 : modifications parallèles, conflit conservé, tests sur résultat combiné, absence de double intégration. |
| **R11** | Déclarer la fin seulement à partir des critères satisfaits et des preuves sur la version livrée. | [L08](../lots/L08-orchestration.md), [L11](../lots/L11-recette-documentation.md), [L12](../lots/L12-release.md) | AC-L08-05, AC-L11-05/07, AC-L12-06 : défaut bloquant, correction, relance des contrôles et clôture justifiée. |
| **R12** | Conserver et reprendre le travail après déconnexion, interruption ou remplacement d’une session. | [L02](../lots/L02-etat-persistant.md), [L07](../lots/L07-superviseur-outils.md), [L10](../lots/L10-reprise-resilience.md) | AC-L02-04, AC-L07-04, AC-L10-01/02/03/04/07 : traces avant/après, dossier de reprise et rejet des anciennes tentatives. |
| **R13** | Gérer la concurrence de un à sept agents, les limites fournisseur et les boucles sans progrès. | [L07](../lots/L07-superviseur-outils.md), [L08](../lots/L08-orchestration.md), [L10](../lots/L10-reprise-resilience.md), [L11](../lots/L11-recette-documentation.md) | AC-L07-05, AC-L08-06, AC-L10-06, AC-L11-04 : une place sans interblocage, charge cible chef compris, attente explicite et conservation des travaux. |
| **R14** | Présenter une conversation centrale, un état fidèle et des vues inspectables ; rester pilotable en CLI. | [L09](../lots/L09-cli-tui.md) | AC-L09-02/03/04/05/06 : demande, question, reprise, inspection de contexte, sorties structurées et redimensionnement. |
| **R15** | Conserver l’auth native, protéger les accès locaux et empêcher une note ou un agent de s’accorder des droits. | [L01](../lots/L01-socle-contrats.md), [L03](../lots/L03-contexte-prompts.md), [L04](../lots/L04-claude.md), [L05](../lots/L05-codex.md), [L07](../lots/L07-superviseur-outils.md) | AC-L01-03, AC-L03-06, AC-L04-04, AC-L07-03 : opération hors périmètre refusée, permission visible et absence de secrets dans le paquet. |
| **R16** | Construire, tester, installer et documenter une V1 portable ; distinguer plateformes vérifiées et non vérifiées. | [L01](../lots/L01-socle-contrats.md), [L11](../lots/L11-recette-documentation.md), [L12](../lots/L12-release.md) | AC-L01-01/05, AC-L11-06, AC-L12-01/02/04/05/07 : CI hors ligne fournisseur, npm pack, installation propre, migration et matrice OS. |

## Conditions transversales

### Tranches de preuve

1. **Contrats et tests déterministes** : L01–L07 rendent les invariants vérifiables hors ligne.
2. **Premier résultat réel** : après L08, un chef et deux exécutants, avec Claude et Codex, accomplissent une petite mission, réunissent les changements et traitent au moins un retour.
3. **Recette fonctionnelle complète** : L11 valide projet nouveau, feature existante, mise à jour de contexte, revue, incidents et capacité cible.
4. **Livraison installable** : L12 reproduit l’usage depuis le paquet installé, sur des projets distincts, avec la matrice des plateformes.

### Minimum d’une preuve recevable

Toute preuve indique le critère concerné, la date, l’auteur ou l’exécuteur, les versions, la révision testée, le scénario, les commandes réelles, le résultat et l’emplacement de la trace. Les secrets sont filtrés. Le mode de vérification est `simulated`, `live` ou `static`, conformément au modèle de données. `fake` désigne le fournisseur simulé ; l’exécution manuelle ou automatisée est enregistrée séparément. Un contrôle manuel sur fournisseur réel conserve donc le mode `live` et indique son exécution manuelle.

Un échec ou un accès indisponible laisse le critère ouvert. Une revue doit examiner une livraison identifiable. Une modification ultérieure invalide les vérifications touchées et exige leur renouvellement. Le coordinateur consolide ces preuves dans le rapport final.

## Extensions prévues, sans masquer la V1

Les interfaces doivent permettre d’ajouter Cursor, une interface web et des hôtes d’exécution distants. Ces extensions ne sont pas exigées pour accepter la V1 définie dans ce dossier. Le lancement local, les deux fournisseurs réels, la continuité du contexte, la boucle d’orchestration et les reprises restent obligatoires.

## Registre initial des preuves

**État à la remise du dossier : aucune preuve d’exécution du produit Avity Crew.** Les vérifications éventuelles du dossier et de son utilitaire de coordination ne satisfont pas les critères produit ci-dessus. Ajouter les références de preuves lorsque les agents auront construit et exécuté le logiciel.

