# Vérification du dossier livré

Date : 24 octobre 2026.

Les vérifications enregistrées ici portent sur **le dossier de construction et ses utilitaires**, pas sur le futur produit Avity Crew.

## Résultats observés
- Utilitaire de coordination du chantier : 20 tests réussis.
- Installation des relais d'instructions : 8 tests réussis.
- Structure du pack : 13 lots, 79 critères d'acceptation, 16 exigences et 8 prompts.
- Liens locaux, dépendances sans cycle, variables des prompts, schémas et exemples contrôlés.
- Aucun compte fournisseur sollicité, aucun lot applicatif déclaré accepté.

Les logs sont conservés dans [coordination-tests.log](coordination-tests.log), [bootstrap-tests.log](bootstrap-tests.log) et [pack-structure.json](pack-structure.json). Les compteurs de liens/fichiers reflètent le passage du validateur enregistré ; l'ajout de ce rapport peut faire évoluer ces compteurs sans changer le résultat.

## Reproduire
Depuis le dossier de travail :
```bash
python3 -B scripts/test_coordination.py
python3 -B scripts/test_bootstrap.py
python3 -B scripts/validate_pack.py
```

Les tests des utilitaires travaillent dans des répertoires temporaires. Le registre réel `coordination/STATE.json` n'est pas initialisé par ces tests. Les contrôles d'intégrité de l'archive sont décrits par le manifeste livré à sa racine.

## Recettes applicatives à réaliser
Les preuves L00 à L12 seront produites par les agents pendant le chantier, dans des sous-dossiers de validation distincts. Les scénarios de [../docs/ACCEPTANCE.md](../docs/ACCEPTANCE.md) restent tous à exécuter sur le produit à construire.

