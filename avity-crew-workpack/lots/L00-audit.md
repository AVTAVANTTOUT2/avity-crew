# L00 — Audit du dépôt et cadrage de la construction

**Dépendances :** aucune.  
**Résultat :** un point de départ vérifié pour construire **Avity Crew**, avec les décisions nécessaires consignées.  
**Propriétaire conseillé :** agent intégrateur / architecte.

**Références :** [consignes de construction](../agent.md), [PRODUCT](../docs/PRODUCT.md), [ARCHITECTURE](../docs/ARCHITECTURE.md), [PROVIDERS](../docs/PROVIDERS.md).

## Objectif

Reconnaître le dépôt qui accueille le dossier, conserver les travaux existants et transformer les spécifications en décisions d’implémentation cohérentes. Ce lot prépare la construction du produit Avity Crew. L’exemple du planning chauffeur sert de scénario de recette ; il n’autorise pas à modifier une application de transport réelle.

## Entrées à lire

Lire le guide de démarrage, les consignes des agents, le cahier des charges, l’architecture, le protocole de contexte, la définition de terminé et le registre des lots. Examiner ensuite le dépôt réel : structure, instructions existantes, statut Git, langage, dépendances, scripts, tests, CI et documentation. Les instructions propres au dépôt et les demandes utilisateur déjà formulées doivent être prises en compte.

## Travail à réaliser

1. Établir si le dépôt est vide, contient déjà Avity Crew ou porte un autre produit. Identifier explicitement la racine de construction retenue. Préserver les modifications locales ; ne pas les supprimer ou les intégrer implicitement dans les livraisons des agents.
2. Produire une carte initiale du dépôt. Distinguer les faits observés, les hypothèses et les décisions à prendre. Citer les fichiers utiles au lieu de recopier tout leur contenu.
3. Relever les versions locales utiles et la disponibilité de Git, Node, npm, Claude Code et Codex. Employer les commandes de version et d’aide, et les mécanismes documentés de statut de connexion ; ne jamais afficher ou copier les identifiants de connexion.
4. Vérifier, dans la documentation officielle correspondant aux versions réellement utilisées, les interfaces programmatiques des deux fournisseurs : démarrage, flux d’événements, reprise explicite, interruption, outils et permissions. Inscrire les capacités absentes comme absentes.
5. Confirmer ou adapter par décision argumentée le socle proposé : TypeScript strict, Node 24 LTS, npm workspaces, SQLite et service local propriétaire de l’état. Figer les versions directes choisies et prévoir un lockfile. Tout écart utile reste traçable et conserve les critères d’acceptation.
6. Définir les commandes communes de développement, construction et vérification que L01 créera. Fixer les conventions de chemins, d’API interne, d’erreurs et d’identifiants.
7. Préparer un plan d’affectation initial. L01 commence après validation de ce cadrage ; les adaptateurs pourront ensuite avancer en parallèle du stockage.

## Livrables

Créer `validation/L00/audit.md` et `validation/L00/compatibility.json`, puis consigner les décisions structurantes dans le registre de décisions. Le rapport indique l’état Git initial, la racine choisie, les éléments déjà présents, les versions, les capacités fournisseur connues, les inconnues restantes et les vérifications qui nécessiteront un compte authentifié.

## Périmètre et coordination

Ce lot possède le cadrage et les décisions transversales. Il ne lance aucune réécriture complète d’un dépôt existant. Les investigations peuvent être réparties entre agents en lecture seule ; un intégrateur consolide leurs conclusions. Toute ambiguïté métier ou de destination réellement bloquante est remontée avec les observations qui permettent de la trancher. Les choix techniques ordinaires sont décidés et documentés.

## Vérification et critères d’acceptation

- **AC-L00-01 — Dépôt identifié :** racine, statut initial et périmètre de construction sont explicites ; aucun fichier utilisateur n’a été supprimé.
- **AC-L00-02 — Versions et capacités :** le rapport distingue interfaces documentées, capacités détectées localement et essais réels restant à faire.
- **AC-L00-03 — Décisions utilisables :** L01 peut commencer sans devoir réinventer les conventions fondamentales.
- **AC-L00-04 — Accès protégés :** les rapports ne contiennent aucun secret et ne prétendent pas que les essais live ont réussi.
- **AC-L00-05 — Plan cohérent :** les dépendances des lots sont comprises et les éventuels écarts du dépôt sont accompagnés d’une décision.

## Passation

Transmettre les références des observations, décisions, commandes retenues et risques concrets à L01. Mentionner séparément la disponibilité des comptes pour les futurs essais live : leur absence ne bloque pas l’écriture du socle, mais empêchera la validation finale de ses intégrations réelles.

