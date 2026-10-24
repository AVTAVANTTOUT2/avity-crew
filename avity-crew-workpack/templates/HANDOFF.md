# Livraison de mission

Ce modèle décrit le compte rendu humain accompagnant un `Handoff` version 1. Il ne remplace pas les validations de schéma et les preuves du superviseur.

## Corrélation

- Objectif / run :
- Mission :
- Agent (`crew_id`) :
- Tentative (`attempt_id`) et génération :
- Session fournisseur (`provider_session_id`), si utile à la reprise :
- Version du contrat de mission :
- Version du contexte utilisé :
- Date :

## État déclaré

Choisir exactement une valeur : `delivered`, `partial` ou `blocked`.

**Valeur :**

**Résultat obtenu :**

**Ce qui reste à faire ou empêche la fin :**

## Artefacts livrés

| Artefact | Chemin ou référence | Version / SHA / empreinte | Rôle dans la livraison |
| --- | --- | --- | --- |
| À renseigner | | | |

- Révision de départ :
- Révision livrée ou état des changements non commités :
- Fichiers créés, modifiés ou supprimés :
- Modifications préexistantes préservées :

## Résultat par critère

| Critère de la mission | Satisfait / partiel / non vérifié / en échec | Preuve correspondante | Limite connue |
| --- | --- | --- | --- |
| À renseigner | | | |

## Vérifications réellement exécutées

| Commande ou contrôle | Révision testée | Résultat / code retour | Référence de preuve | Environnement |
| --- | --- | --- | --- | --- |
| À renseigner | | | | |

**Vérifications non exécutées et raisons :**

**Distinction simulations / fournisseurs réels :**

## Passation aux autres missions

- Interfaces modifiées et version du contrat :
- Décisions nouvelles proposées ou déjà approuvées :
- Mises à jour reçues et prises en compte :
- Agents ou tâches à informer :
- Risques et hypothèses restantes :
- Prochaine action recommandée :

Le statut `delivered` demande l’examen de cette livraison. La tâche ne devient `accepted` qu’après les vérifications et transitions contrôlées par le superviseur.
