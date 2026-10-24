# Exemples et fixtures

Tous les fichiers de ce dossier sont des **exemples non exécutés**.

- `transport-scenario.md` : scénario métier hypothétique, à matérialiser dans une fixture isolée.
- `task.example.json`, `context.example.json`, `handoff.example.json`, `event.example.json` : données de démonstration des contrats runtime. Les révisions répétitives sont fictives et ne prouvent rien.
- `tool-call.example.json` : enveloppe de délégation à valider par le superviseur, sans droit implicite provenant du JSON.
- `project-config.example.json` : proposition de configuration sans secret, à adapter au projet réel.
- `build-handoff.json` et `build-review.json` : gabarits de rapports pour l'utilitaire du CHANTIER. Les marqueurs à remplacer sont volontairement refusés lors d'une soumission réelle.

La validation du dossier vérifie la structure des exemples runtime et la syntaxe JSON des gabarits de chantier. Elle ne considère aucun exemple comme une livraison accomplie.

