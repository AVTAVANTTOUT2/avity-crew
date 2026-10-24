# Recette fictive — planning créé par un chauffeur

**Exemple de produit cible. Aucune observation du code réel d'Avity Transport n'est affirmée ici.**
La mission du chantier reste de construire Avity Crew. Ce scénario sert ensuite à éprouver son fonctionnement sur une fixture isolée.

## Demande
« Permettre aux chauffeurs de créer leur planning lorsque le chef d'entreprise n'a pas préparé de planning applicable. »

## Exploration attendue du chef
Examiner ce que représentent planning, chauffeur, entreprise, journée/créneau et création ; repérer droits, états, persistance, composants et tests existants. Noter les réponses trouvées et les questions restantes.

## Décisions à établir
| Sujet | Question |
|---|---|
| Bénéficiaire | Le chauffeur agit-il uniquement pour lui-même ? |
| Absence | Absence pour la journée, la mission, le créneau ou autre périmètre ? |
| État créé | Actif immédiatement, brouillon ou soumis à validation ? |
| Visibilité | Qui peut consulter la création et son origine ? |
| Concurrence | Quelle réponse si le chef crée entre l'ouverture et l'envoi du formulaire ? |
| Évolution | Quels droits existants s'appliquent ensuite aux modifications ? |

La fixture peut adopter des réponses simples documentées dans une Decision. Ces réponses ne sont pas des exigences supposées du logiciel réel. Ne pas ajouter de droits de suppression par simple déduction.

## Missions possibles
1. Explorer et établir le contrat/critères.
2. Développer la création serveur et ses règles.
3. Développer le parcours chauffeur sur le contrat convenu.
4. Préparer les scénarios de validation.
5. Réunir les changements, relire et corriger.
6. Documenter le fonctionnement vérifié.

Le frontend et les tests peuvent préparer leur travail en parallèle du serveur. Les données simulées utilisées suivent le contrat identifié. Une modification de contrat devient un événement transmis aux missions concernées.

## Incident de recette
Le chef d'entreprise crée un planning après l'ouverture du formulaire chauffeur. L'envoi chauffeur doit suivre la règle de conflit retenue. La vérification doit exercer ce cas et observer le résultat persistant. La correction du message d'interface seule n'est pas suffisante si le serveur produit toujours un doublon.

## Résultat attendu d'Avity Crew
Un objectif tracé, un plan adapté, des briefs utiles, plusieurs sessions coordonnées, des livraisons identifiables, une revue, des tests du résultat réuni et un compte rendu utilisateur. Les comptes rendus montrent les décisions et les preuves ; ils n'inventent aucune exécution en production.

