# Interface CLI/TUI à réaliser

## Expérience principale
Le nom du produit est **Avity Crew**. La commande `avity-crew`, sans argument dans un terminal interactif, ouvre la conversation du projet courant et rejoint le service existant s'il est actif. Dans un répertoire vide, elle permet de décrire un nouveau projet. Elle conserve toujours le chemin réel d'origine ; ne pas utiliser un répertoire global comme workspace du code demandé.

Première utilisation : diagnostic des CLI, sélection du chef et des préférences disponibles, puis saisie de l'objectif. Une erreur d'authentification est présentée avec le chemin de connexion natif, sans demander de coller un secret dans la conversation.

## Commandes cibles
Ces commandes sont un contrat UX à implémenter, pas des commandes déjà fournies par ce dossier.

| Commande | Résultat attendu |
|---|---|
| `avity-crew` | Ouvrir/rejoindre la conversation et le tableau du projet courant |
| `avity-crew doctor` | Diagnostiquer environnement, Git, CLI, connexions et capacités sans mutation applicative |
| `avity-crew init` | Initialiser les métadonnées et préférences d'un projet, sans effacer sa configuration |
| `avity-crew run --prompt-file mission.md` | Créer un objectif à partir d'un fichier UTF-8 |
| `avity-crew status --json` | Retourner l'état du projet ou du run demandé dans un format versionné |
| `avity-crew attach --run ID` | Retrouver la conversation et les événements d'un run |
| `avity-crew pause --run ID` | Empêcher de nouvelles délégations ; expliquer le sort des tentatives déjà lancées |
| `avity-crew resume --run ID` | Réconcilier puis reprendre le run |
| `avity-crew stop --run ID` | Demander l'arrêt contrôlé des tentatives du run, sans supprimer leurs changements |
| `avity-crew switch-chief --run ID --provider codex` | Remplacer le chef avec checkpoint et transfert de contexte |
| `avity-crew context --task ID` | Montrer le bundle transmis, ses sources et les mises à jour |
| `avity-crew report --run ID` | Produire le rapport et ses références de preuves |
| `avity-crew bridge` | Processus MCP stdio interne, capacité de session requise, pas d'ouverture publique |

Les options communes incluent le projet explicite, le run, le provider et le modèle lorsque pertinents. Le prompt peut aussi venir de stdin. Les arguments ne sont jamais interprétés comme commandes shell. Les modes non interactifs ne restent pas bloqués sur une question invisible.

## Écrans indispensables
### Conversation
Saisie multiligne, collage d'un long prompt, réponse du chef, mise à jour des décisions et questions. Le retour utilisateur devient un événement associé à la question concernée, avec référence et portée.

### Équipe et tâches
Rôle, provider, modèle, tâche active, statut, temps écoulé, blocage et prochaine action. Distinguer tâche prête en file, session active, vérification en cours et résultat accepté. Aucun pourcentage d'avancement fictif.

### Contexte
Objectif, contraintes, décisions, périmètre, références et estimation/mesure du budget. Afficher le bundle réellement envoyé, pas une reconstruction ultérieure. Montrer l'état des mises à jour : enregistrée, transmise, prise en compte.

### Livraisons
Changements, base, source, candidat intégré, revue, tests, résultats et limites. Les logs détaillés s'ouvrent à la demande ; les secrets sont expurgés avant stockage/affichage.

### Interventions
Questions, permissions, conflits et limites fournisseur. Le message doit dire quel travail attend et ce qui peut continuer. Une permission effective vient de l'outil fournisseur ou du cadre d'exécution ; aucune acceptation fictive dans l'interface.

## Interaction avec un agent
L'utilisateur peut ouvrir son journal et envoyer une précision ciblée. Le service met à jour la mission et sa version pour que le chef le sache. Une intervention manuelle dans une session native n'est proposée que si le connecteur permet une reprise de contrôle exclusive ; sinon utiliser le canal de message supporté.

## Cycle de vie
Fermer la TUI laisse le superviseur poursuivre le travail autorisé, après un comportement clairement indiqué. `stop` est distinct de fermer l'affichage. La première interruption clavier peut annuler la saisie ou demander une confirmation locale de l'arrêt du run ; tester ces cas sans perdre les changements.

Un service lancé sur une machine éteinte ne continue pas. La V1 accepte une utilisation via SSH sur un hôte qui reste allumé, sans implémenter une distribution multi-hôtes.

## Accessibilité et robustesse
Gérer redimensionnement, terminal étroit, absence de couleurs, Unicode et sortie non-TTY. Toutes les fonctions essentielles disposent d'une commande textuelle. Les tests utilisent des pseudo-terminaux pour les parcours interactifs et des assertions de sortie pour le mode JSON.

## Contrat de sortie
Les sorties JSON possèdent `schema_version`, `ok`, `data` ou `error`. Les logs humains sont séparés. Une commande refusée fournit un code stable, un motif et une action possible. Les codes de sortie CLI sont figés en L01/L09 : succès, usage invalide, indisponibilité/authentification, attente utilisateur et échec de run doivent être distinguables.

Les commandes qui attendent un résultat ont un délai et un comportement de détachement documentés. Une reconnexion avec un curseur doit récupérer les événements manqués sans les afficher en double.

