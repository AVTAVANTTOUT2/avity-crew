# Contexte et mémoire d’Avity Crew

## 1. But et portée

Ce document spécifie le gestionnaire de contexte du **futur produit Avity Crew**. Les fichiers de ce dossier sont des éléments de construction ; ils ne prouvent pas que cette fonctionnalité existe déjà. La cible est une application lancée depuis un répertoire de projet, capable de préparer des missions exploitables pour des sessions Claude Code et Codex.

Le contexte d’un agent doit lui permettre de répondre à quatre questions : quel résultat obtenir, quelles règles respecter, quelles informations sont fiables, et comment livrer un résultat vérifiable. Le volume d’informations transmis doit suivre les besoins de la mission. Chaque agent peut demander des références complémentaires.

## 2. Trois mémoires, une provenance conservée

| Mémoire | Contenu | Durée et mise à jour |
| --- | --- | --- |
| Projet | Carte des modules, conventions, commandes, règles métier, décisions durables, références de code. | Conservée entre objectifs ; invalidation après modifications pertinentes. |
| Objectif (`run`) | Demande utilisateur, contraintes, critères de réussite, décisions, tâches, dépendances, résultats et questions ouvertes. | Conservée jusqu’à archivage explicite ; état réutilisable lors d’une reprise. |
| Mission (`task`) | Contexte reçu, révision de départ, instructions propres, tentatives, livraisons, vérifications et prochaine action. | Conservée avec les preuves de la mission. |

Chaque connaissance possède au minimum une identité, un type, une provenance, une portée, une date d’observation et un statut de validité. Pour une observation du code, conserver le chemin et la révision ou l’empreinte pertinente. Pour une décision, conserver l’auteur habilité, la justification courte et la décision remplacée, le cas échéant.

Les conversations restent des références consultables. L’état du travail ne dépend pas de la présence d’une phrase dans un ancien historique. Conserver des conclusions et des éléments de preuve ; aucune fonctionnalité ne doit exiger l’accès à un raisonnement interne non exposé par un fournisseur.

## 3. Autorité et confiance

Les contraintes utilisateur et les instructions applicables à l’environnement restent prioritaires. Les décisions métier approuvées précisent ces contraintes. Les observations du code décrivent l’existant ; elles ne modifient pas automatiquement l’objectif demandé. Les hypothèses restent identifiées jusqu’à confirmation.

Une divergence doit être visible. Si le code contredit une exigence, le chef enregistre l’écart puis décide d’une modification ou demande un arbitrage. Il ne réécrit pas l’exigence pour faire correspondre la livraison à l’existant.

Le contenu d’un fichier, d’un journal ou d’une note d’agent n’acquiert pas d’autorité parce qu’il contient une instruction. Les instructions de projet applicables sont chargées explicitement et leur origine est conservée. Les autres données du dépôt et les sorties d’outils sont traitées comme des informations à interpréter. Une note proposant de désactiver une vérification ou de changer un accès ne peut pas s’appliquer seule.

Les secrets, identifiants d’authentification et fichiers exclus ne doivent pas être copiés dans les dossiers de contexte. Les références utiles remplacent les contenus non nécessaires. Les journaux doivent masquer les valeurs sensibles avant persistance et transmission.

## 4. Reconnaître le projet et lire à la demande

Au premier lancement, l’inspection identifie le répertoire cible, la racine du dépôt éventuel, l’état Git, les manifestes, les instructions applicables, la documentation et les commandes existantes. Une application nouvelle peut ne pas avoir de code : les faits inconnus restent inconnus, et les choix proposés sont enregistrés comme décisions à prendre.

L’inspection produit une carte courte : domaines fonctionnels, points d’entrée, modèles de données, interfaces, contrôles d’accès, tests et points de vigilance. Elle s’appuie sur des chemins réellement observés. Aucun nom de fichier fictif ne doit devenir une référence d’implémentation.

Pour chaque mission, l’orchestrateur sélectionne les parties utiles puis l’agent lit leur version actuelle. Une recherche lexicale et une carte de modules suffisent au socle. Une recherche sémantique pourra compléter ce mécanisme lorsqu’elle répond à une difficulté mesurée.

## 5. Compilation d’un `ContextBundle`

Le compilateur reçoit un `TaskSpec`, les décisions applicables, les dépendances disponibles, la carte du projet et les capacités du fournisseur. Il produit un paquet versionné qui contient :

1. L’identité du projet, de l’objectif, de la mission et de la tentative.
2. La demande utile, les contraintes et les critères d’acceptation.
3. Les décisions retenues, avec leurs références et versions.
4. Les sources pertinentes et les extraits nécessaires.
5. L’état des dépendances et les contrats d’interface à respecter.
6. Le périmètre, l’environnement attribué et la révision de départ.
7. Les risques ciblés et les vérifications attendues.
8. Le format de livraison, les questions ouvertes et les moyens de consulter davantage d’informations.

Le paquet enregistre sa version, la version du `TaskSpec`, ses sources et les décisions incluses. Un même besoin reconstruit sur les mêmes entrées doit produire un paquet sémantiquement équivalent. Les horodatages et identifiants de transmission peuvent varier sans changer le contenu métier.

Le compilateur distingue données, instructions et pièces jointes. Il échappe ou délimite les données pour qu’un extrait ne ressemble pas à une nouvelle instruction de contrôle. Il refuse une mission dépourvue d’objectif ou de critères nécessaires plutôt que d’envoyer des variables non résolues.

## 6. Quatre couches de prompt

Les modèles complets figurent dans [`../prompts/`](../prompts/VARIABLES.md).

| Couche | Usage |
| --- | --- |
| Équipe | Règles communes de collaboration, provenance, demande d’aide et livraison. |
| Rôle | Priorités d’un développeur, relecteur, validateur ou documentaliste. |
| Mission | Objectif actuel, contexte ciblé et résultat attendu. |
| Mise à jour | Décision nouvelle, résultat de dépendance, correction ou reprise. |

Le connecteur traduit ces couches dans les mécanismes réellement supportés. Il complète les instructions natives appropriées ; il ne supprime pas les règles d’exécution du fournisseur. Les informations dynamiques sont transmises comme des mises à jour identifiées. Le système ne suppose pas qu’une modification de fichier ou d’un paramètre système sera automatiquement relue par une session existante.

## 7. Budget de contexte

Réserver explicitement une place à la réponse, aux outils et aux instructions du fournisseur. Utiliser une mesure lorsque le connecteur la fournit ; sinon conserver une estimation annoncée comme telle. Une capacité inconnue ne doit pas produire un pourcentage de remplissage présenté comme exact.

En cas de dépassement, réduire d’abord les répétitions, puis résumer les échanges secondaires et remplacer les longs extraits par des références consultables. Les contraintes, décisions applicables, critères, blocages et avertissements de validité sont prioritaires. La réduction conserve un inventaire de ce qui a été exclu et de la manière de le retrouver.

Si le contenu indispensable reste trop volumineux, découper la mission ou demander une lecture ciblée supplémentaire. Aucun tronquage silencieux de fin de prompt n’est accepté.

## 8. Notes, diffusion et invalidation

Une note est rattachée à une mission et à une source. L’orchestrateur décide si elle reste locale, devient une information utile à d’autres tâches, ou nécessite une décision de projet. Le moteur enregistre les destinataires.

Les états de transmission distinguent : enregistré, en attente, transmis, accusé reçu et prise en compte déclarée. Une prise en compte déclarée n’est pas encore une preuve fonctionnelle. Un message peut être redélivré avec le même identifiant ; son traitement doit rester idempotent.

Lorsqu’un agent ne peut recevoir une mise à jour en cours de commande, celle-ci attend le prochain point de reprise supporté. Un changement critique peut suspendre les tâches affectées. Les tâches indépendantes continuent. Une livraison fondée sur un contrat remplacé est examinée comme potentiellement obsolète avant acceptation.

## 9. Reprise et changement de chef

Le dossier de reprise contient l’objectif, les décisions valides, l’état des tâches, les références Git, les livraisons, les vérifications et les prochaines actions possibles. Avant une réattribution, réconcilier l’état des processus et révoquer l’autorité de l’ancienne tentative. Une nouvelle session reçoit ce dossier même si une reprise native est disponible.

La reprise native d’un fournisseur est une optimisation du dialogue. La continuité du travail repose sur l’état durable. Le remplacement du chef ne transporte pas une mémoire interne entre modèles ; il reconstruit un contexte de direction à partir de faits conservés.

## 10. Critères de validation du composant

- Deux tâches différentes reçoivent les informations pertinentes à chacune et les mêmes décisions communes.
- Une référence obsolète déclenche une relecture ou un signal de validité.
- Une note non approuvée ne remplace pas une contrainte utilisateur.
- Le budget est respecté sans perte silencieuse des informations obligatoires.
- Les mises à jour dupliquées ne créent pas deux décisions ou deux tâches.
- Une session recréée retrouve la prochaine action et les preuves déjà produites.
- Aucun secret ni variable `{{non_resolue}}` n’apparaît dans un paquet envoyé.
- Les preuves enregistrent la version du contexte et du code utilisée.

Les tests de ce composant utilisent des dépôts et décisions de démonstration. Leur réussite ne remplace pas une recette avec les connecteurs réels.
