# L11 — Recette complète, documentation et CI finale

**Dépendances :** [L10](L10-reprise-resilience.md).  
**Résultat :** une V1 démontrée par des parcours complets, des preuves rattachées aux versions et une documentation cohérente.  
**Propriétaire conseillé :** agent validation, avec un relecteur distinct des auteurs principaux.

**Références :** [consignes de construction](../agent.md), [ACCEPTANCE](../docs/ACCEPTANCE.md), [TRACEABILITY](../docs/TRACEABILITY.md).

## Objectif

Vérifier le produit que l’utilisateur attend : une demande devient un résultat contrôlé grâce à plusieurs sessions locales et au bon partage de contexte. Consolider la documentation à partir du comportement obtenu. Une suite de tests de parsing ou une interface de démonstration ne remplace pas ces parcours.

## Scénarios à réaliser

1. **Projet nouveau :** demander une petite application dont les critères sont définis, obtenir un découpage, des missions, des livraisons réunies et un résultat utilisable.
2. **Projet existant :** utiliser une fixture représentative d’Avity Transport ; demander la création de planning par le chauffeur et vérifier les règles métier retenues, les droits, les erreurs et la concurrence. Ne pas utiliser une production réelle comme fixture.
3. **Retour de revue :** introduire ou faire découvrir un défaut observable, obtenir une mission corrective et une nouvelle validation de la révision corrigée.
4. **Contexte actualisé :** changer un contrat ou une décision pendant le run ; vérifier les informations reçues par les seules missions concernées.
5. **Équipe de sept :** faire fonctionner jusqu’à sept sessions dans le budget et les capacités disponibles, avec travaux indépendants, ressources séparées et progression observable. Compter le chef dans cette limite.
6. **Fiabilité :** rejouer les incidents essentiels L10 sur une configuration proche de celle livrée.
7. **Chef interchangeable :** exécuter ou reprendre un objectif avec chacun des deux moteurs de chef.
8. **Livraison documentaire sans Git :** dans un dossier jetable sans dépôt, demander un document vérifiable, le faire produire et relire par des sessions distinctes, puis observer `accept_delivery` et la clôture fondées sur les empreintes et preuves. Le parcours ne doit pas exiger de commit, de merge ni d’initialisation Git.

## Preuves et rapports

Pour chaque scénario, enregistrer l’objectif, les versions, les fournisseurs réels ou simulés, les identifiants utiles, le code livré, les commandes, résultats, incidents et critères satisfaits. L’acceptation se rapporte à une révision précise.

Les tests rapides et fixtures restent séparés des essais live. Aucun compte fournisseur n’est ajouté aux jobs ordinaires de CI. Les essais réels peuvent être déclenchés manuellement dans un environnement autorisé, avec un budget borné et des journaux filtrés. Une absence d’accès se traduit par `live_unverified` ou `blocked`, jamais par une case cochée.

## Documentation à finaliser

Documenter installation, prérequis, lancement depuis un dossier, choix du chef, contexte, missions, permissions, états, arrêt/reprise et dépannage. Fournir un guide d’ajout d’adaptateur et un exemple de run complet. Mettre à jour le changelog du produit uniquement avec ce qui a réellement été livré.

Distinguer le journal des événements de la documentation durable. Le premier explique le déroulement ; la seconde décrit les décisions et comportements que les prochains développeurs devront connaître.

## CI finale

Vérifier que la CI exécute les contrôles nécessaires : types, construction, tests du domaine, adaptateurs sur fixtures, intégration locale, migrations et empaquetage à blanc. Ajouter une vérification lorsqu’elle couvre un risque réel, pas pour reproduire l’implémentation. Conserver les preuves de l’échec puis de la correction d’une régression représentative.

## Critères d’acceptation

- **AC-L11-01 — Parcours nouveau :** une demande aboutit à un livrable utilisable et contrôlé.
- **AC-L11-02 — Feature existante :** le scénario chauffeur fonctionne sur les changements réunis et préserve les parcours préexistants.
- **AC-L11-03 — Équipe réelle :** Claude et Codex participent à une orchestration mixte avec résultats observés.
- **AC-L11-04 — Charge cible :** la capacité jusqu’à sept sessions est vérifiée et ses limites mesurées sont documentées.
- **AC-L11-05 — Transparence :** les preuves simulées ne sont jamais présentées comme live.
- **AC-L11-06 — Documentation :** commandes et comportements documentés correspondent à la révision acceptée.
- **AC-L11-07 — Régressions :** un échec bloque réellement l’acceptation du résultat concerné.
- **AC-L11-08 — Objectif documentaire :** le parcours complet sans Git produit, fait relire et accepte un document identifié, avec une clôture justifiée par ses preuves.

## Passation

Fournir le rapport de recette, la matrice d’exigences renseignée par preuves et la liste précise des écarts. L12 peut préparer un paquet à examiner, mais la livraison « V1 fonctionnelle vérifiée » exige que les critères obligatoires soient satisfaits.

