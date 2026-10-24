# L03 — Contexte du projet, mémoire et compilation des prompts

**Dépendances :** [L02](L02-etat-persistant.md).  
**Résultat :** chaque mission reçoit un contexte pertinent, vérifiable et réactualisable.  
**Propriétaire conseillé :** agent contexte / prompts.

**Références :** [consignes de construction](../agent.md), [CONTEXT](../docs/CONTEXT.md), [ORCHESTRATION](../docs/ORCHESTRATION.md).

## Objectif

Construire la fonction centrale d’Avity Crew : transformer une demande et un état de projet en brief exploitable par une session de travail. Le produit conserve une carte du dépôt et des références utiles ; il consulte les fichiers actuels nécessaires plutôt que de supposer qu’une ancienne synthèse est encore exacte.

## Travail à réaliser

1. Implémenter la reconnaissance d’un projet existant ou nouveau : structure, instructions, manifestes, commandes, documents et modules pertinents. Respecter les exclusions et éviter l’ingestion automatique de secrets, dépendances téléchargées ou sorties de construction.
2. Produire une carte sourcée du projet. Toute observation importante possède une origine, une révision ou empreinte, une date et une portée. Distinguer observations, hypothèses, propositions et décisions retenues.
3. Construire le contexte d’une mission à partir de l’objectif global, des critères, décisions applicables, fichiers pertinents, dépendances disponibles et dernières informations ciblées.
4. Séparer les instructions d’équipe stables, les consignes de rôle, le brief actuel et les mises à jour. Adapter leur transport aux capacités du fournisseur sans dépendre d’un changement implicite de prompt système.
5. Implémenter une sélection sous budget. Préserver les critères, contraintes et informations nécessaires avant les détails secondaires. Signaler une omission importante ou une estimation de taille approximative ; ne pas présenter une estimation de tokens comme une mesure fournisseur.
6. Enregistrer le paquet réellement envoyé : version de template, références, exclusions, révision cible et identité de tentative. La vue d’inspection doit expliquer pourquoi une information est présente.
7. Invalider ou actualiser les éléments touchés par une livraison ou une décision nouvelle. Une information périmée reste consultable avec son statut, mais ne devient pas une règle actuelle.
8. Produire un dossier de reprise pour nouvelle session ou changement de chef : objectif, décisions, état Git, travaux en cours, blocages, preuves et prochaine action.

## Communication et confiance

Une note d’agent est un élément de travail avec une provenance. Elle ne peut pas modifier à elle seule les permissions, la demande utilisateur ou les règles globales. Une suggestion de changement d’interface doit être adoptée comme décision avant d’être propagée comme contrat.

Le chef reçoit un état global synthétique et peut ouvrir les pièces détaillées. Les exécutants reçoivent ce qui leur est nécessaire et disposent d’un moyen d’en demander davantage. Le contexte commun n’est pas diffusé intégralement à chaque événement.

## Périmètre et parallélisation

Le lot possède le compilateur de contexte, les templates et les vues de mémoire. Les interfaces fournisseur demeurent dans L04/L05. L07 utilisera le paquet compilé et enregistrera ses transmissions. Les références de fichiers doivent supporter des chemins comportant des espaces et rester liées au bon projet.

## Vérifications

Construire une fixture avec un contrat initial puis modifié. Préparer deux missions ayant des besoins différents et vérifier leurs paquets. Reprendre une mission dans une nouvelle session à partir de son dossier. Ajouter des notes contradictoires, une référence supprimée et un budget insuffisant. Vérifier les décisions conservées et les erreurs explicites.

## Critères d’acceptation

- **AC-L03-01 — Pertinence :** deux missions distinctes reçoivent leurs références utiles sans héritage arbitraire de toute l’équipe.
- **AC-L03-02 — Actualisation :** un contrat remplacé est signalé comme périmé et les missions concernées reçoivent la nouvelle version.
- **AC-L03-03 — Provenance :** le paquet inspecté correspond au paquet réellement envoyé.
- **AC-L03-04 — Reprise :** les informations indispensables restent présentes après création d’une nouvelle session.
- **AC-L03-05 — Contraintes préservées :** la réduction du contexte ne retire pas silencieusement un critère de réussite ou une restriction.
- **AC-L03-06 — Contenu externe :** une note ne peut pas s’octroyer l’autorité de changer les permissions ou l’objectif.

## Passation

Livrer les templates versionnés, exemples de paquets et règles d’invalidation. Expliquer les limites de sélection et les comportements lorsque le dépôt ou le contexte ne permettent pas encore une délégation fiable.

