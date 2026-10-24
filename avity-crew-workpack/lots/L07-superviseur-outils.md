# L07 — Superviseur local et outils de coordination

**Dépendances :** [L03](L03-contexte-prompts.md), [L04](L04-claude.md), [L05](L05-codex.md), [L06](L06-workspaces-git.md).  
**Résultat :** un service local pilote les sessions et expose des actions d’équipe contrôlées.  
**Propriétaire conseillé :** agent runtime / intégration.

**Références :** [consignes de construction](../agent.md), [ARCHITECTURE](../docs/ARCHITECTURE.md), [DATA_MODEL](../docs/DATA_MODEL.md), [ORCHESTRATION](../docs/ORCHESTRATION.md).

## Objectif

Relier état, contexte, fournisseurs et espaces de travail. Le superviseur possède les processus et les transitions. Les agents interagissent avec lui par un bridge MCP stdio vers le service local, avec une CLI interne de repli documentée et testée, sans accès direct à ses tables. Les deux transports appliquent les mêmes règles de validation et d’autorité.

## Travail à réaliser

1. Démarrer un service local dont la durée de vie est indépendante de la vue terminal. Définir son emplacement, son verrou d’instance, ses journaux et sa procédure d’arrêt. Plusieurs clients ne créent pas plusieurs superviseurs pour le même projet.
2. Exposer un canal local protégé : socket système ou adresse de boucle locale avec authentification adaptée. Chaque session reçoit un périmètre lié à sa mission et sa tentative. Le service dérive son identité du canal authentifié, pas d’un champ libre du prompt.
3. Implémenter les actions d’équipe : consulter le contexte, créer et attribuer une mission, signaler un progrès ou un blocage, transmettre un message, poser une question, soumettre une livraison et lire les preuves accessibles. Ajouter les mutations explicites : `record_decision` pour le chef, avec une décision technique ou une réponse utilisateur référencée et l’acteur vérifié par le moteur ; `submit_review` pour le relecteur, avec `approved`, `changes_requested` ou `blocked`, y compris un refus avant candidat ; `accept_delivery` pour la demande d’acceptation du chef, soumise aux revues indépendantes et preuves exigées.
4. Différencier les droits du chef, d’un exécutant et d’un client utilisateur. Un exécutant peut documenter sa mission ; il ne peut pas s’accorder la permission de réattribuer toute l’équipe ou de marquer seul l’objectif global comme terminé.
5. Construire le paquet de contexte, créer le workspace, lancer l’adaptateur, enregistrer l’identité de session et router ses événements. Vérifier l’état avant toute relance.
6. Gérer concurrence, files d’attente et ressources. La limite d’agents est configurable, jusqu’à sept dans la recette V1, et comprend le chef lorsqu’il est actif.
7. Distinguer requête en attente, absence de sortie récente et processus mort. Les demandes utilisateur et permissions doivent devenir visibles ; le silence d’un modèle ne suffit pas à déclencher un doublon.
8. Prévoir l’attachement d’un client, les lectures paginées, l’arrêt contrôlé d’une mission et la fermeture du service sans suppression du travail.

## Interfaces

Les actions publiques utilisent les contrats L01 et passent par les transactions L02. Le bridge traduit les transports sans dupliquer la logique métier. Il doit supporter une opération répétée, une session révoquée et un message adressé à une tentative devenue obsolète. `propose_integration` prépare le candidat de code et les contrôles ; `accept_delivery` conclut la transition après les conditions requises. Une livraison documentaire suit aussi `accept_delivery`, avec ses artefacts et preuves, sans création d’un candidat Git fictif.

Les adaptateurs L04/L05 sont les seuls composants qui connaissent les particularités fournisseur. L07 choisit leurs comportements selon leur matrice de capacités et transmet les limitations à l’interface.

## Vérifications

Exécuter une mission avec chaque fournisseur ou avec ses fixtures selon le niveau de preuve. Tester deux clients connectés, la déconnexion du terminal, une session qui tente une opération hors périmètre, une demande sans réponse immédiate et la récupération d’un résultat après reconnexion.

## Critères d’acceptation

- **AC-L07-01 — Propriété :** une seule instance pilote les processus d’un projet et deux clients voient le même état.
- **AC-L07-02 — Routage :** événements et messages atteignent uniquement les sessions prévues.
- **AC-L07-03 — Autorité :** une session ne peut pas changer son identité ou son périmètre par du texte.
- **AC-L07-04 — Persistance :** fermer la vue terminal ne détruit ni le service prévu pour continuer, ni ses missions.
- **AC-L07-05 — Travail observable :** lancement, attente, interruption et livraison correspondent à des états constatés.
- **AC-L07-06 — Compatibilité :** les deux adaptateurs peuvent participer au même run sans format spécial dans le domaine.

## Passation

Fournir les commandes de service et de bridge, le protocole local, les règles de droits et les traces d’un parcours complet. Les preuves live manquantes restent marquées et doivent être complétées avant la recette finale.

