# L01 — Revue statique Claude et traitement

Session Claude Code réelle : `5ded16f9-5b1f-48b6-ad0f-795f98c7c246`, modèle
observé `claude-opus-5-5`, exit 0, aucune permission refusée, aucun sous-agent.
Candidat lu : `78ffc5bafd7c593cb779961a7ba86e23feb55398`. Les fichiers ciblés
ont été fournis explicitement sur stdin, aucun outil ou accès d'écriture.
Aucune commande de test n'a été revendiquée par cette revue statique.
Une première tentative avec outils a expiré à 55 s sans résultat ; elle ne
constitue pas une revue réussie. La seconde a terminé en environ 175 s.

Findings retenus pour correction :

- Livraison périmée : vérifier aussi TaskState.active_attempt_id/generation et
  la transition de tâche, puis tester une tentative ancienne cohérente avec
  elle-même après réattribution.
- Simulation interrompue : résoudre le résultat avec la fin/interruption du
  flux, tester une interruption après réception d'un événement.
- Envoi non supporté : refus UNSUPPORTED au lieu d'une queue inexistante.
- Typage de validate : lier le nom de définition au type généré, refuser les
  sous-pointeurs arbitraires et activer Ajv strict.
- Compléter les gardes de run et la couverture des preuves simulées, producteurs
  étrangers et tentatives inactives.
- Copier les schémas et fixtures dans le produit pour que sa construction
  n'utilise pas l'utilitaire ou le dossier du chantier.

La revue proposait également des points à qualifier faute de fichiers complets
(lockfile, workspace manifests, schéma, ignore formatter). Ces fichiers existent
et sont exercés par le reviewer sur checkout propre. Aucune garantie multi-OS,
CI distante ou packaging final n'est déduite de cette revue. Les migrations,
transitions persistantes et contrôles d'autorité complets restent à L02/L07.
Les abstractions et extensions sans besoin immédiat n'ont pas été ajoutées.
