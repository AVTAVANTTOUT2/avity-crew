# L12 — Installation portable et livraison finale

**Dépendances :** [L11](L11-recette-documentation.md).  
**Résultat :** un paquet installable, une commande fonctionnelle depuis plusieurs projets et une livraison accompagnée de ses preuves.  
**Propriétaire conseillé :** agent release / intégrateur.

**Références :** [consignes de construction](../agent.md), [CLI](../docs/CLI.md), [ACCEPTANCE](../docs/ACCEPTANCE.md), [TRACEABILITY](../docs/TRACEABILITY.md).

## Objectif

Transformer la version validée en logiciel qu’Elias peut installer et lancer depuis son terminal, indépendamment de l’emplacement du projet. Ce lot vérifie l’installation et l’utilisation réelles ; il n’autorise pas une publication sur un registre ni un déploiement de projet utilisateur.

## Travail à réaliser

1. Finaliser les métadonnées du paquet, le binaire `avity-crew`, les fichiers distribués, les assets de prompts et les migrations. Vérifier qu’aucun chemin de développement, secret, base de travail ou journal privé ne se retrouve dans le paquet.
2. Produire un paquet local avec `npm pack`. Inspecter son contenu et l’installer dans un environnement ou préfixe temporaire propre. Tester le binaire ainsi installé, pas uniquement un script de développement.
3. Lancer la commande depuis deux projets distincts dont au moins un chemin contient des espaces. Vérifier détection de racine, séparation de l’état, reprise, accès au bon contexte et absence de dépendance à l’emplacement du code source d’Avity Crew.
4. Réaliser la matrice macOS, Linux et Windows via WSL avec les prérequis documentés. Pour chaque plateforme non effectivement testée, inscrire explicitement `not_verified` ; cette ligne reste un écart à la cible de portabilité.
5. Vérifier que les dépendances natives éventuelles, notamment le pilote SQLite retenu, s’installent et fonctionnent sur les environnements couverts. Prévoir les messages de diagnostic et procédures documentées lorsqu’un prérequis manque.
6. Vérifier la mise à jour depuis une version précédente de test et la conservation des données. L’arrêt du service, la migration et la relance doivent suivre un ordre documenté.
7. Préparer les instructions d’installation locale, mise à jour, désinstallation du programme et conservation ou suppression explicite des données. La désinstallation du binaire ne doit pas supprimer automatiquement les projets.
8. Établir le rapport final et mettre à jour le changelog avec les réalisations vérifiées, les changements de compatibilité et les limites restantes.

## Contrôle final du périmètre

La V1 comprend le terminal, les sessions Claude et Codex, le chef interchangeable, les missions contextualisées, la boucle de correction, la mémoire durable, les espaces de travail et la validation. Cursor, une interface web et une exécution distribuée peuvent être documentés comme extensions ; ils ne masquent aucune fonction obligatoire manquante.

Le résultat final indique le niveau réellement atteint : paquet préparé, installé et vérifié, ou livraison bloquée par des critères non satisfaits. Il ne promet pas une disponibilité générale sur une plateforme sans preuve.

## Vérifications et critères d’acceptation

- **AC-L12-01 — Paquet complet :** le paquet local contient tout ce qui est nécessaire et aucun secret ou état de développement.
- **AC-L12-02 — Installation réelle :** installation du paquet, aide, diagnostic et lancement d’un objectif fonctionnent depuis un préfixe propre.
- **AC-L12-03 — Deux projets :** deux dossiers distincts, dont un avec espaces, conservent des objectifs et contextes séparés.
- **AC-L12-04 — Portabilité :** chaque plateforme cible possède une preuve ou un écart explicitement non validé ; la cible complète n’est déclarée atteinte qu’après vérification.
- **AC-L12-05 — Mise à jour :** une base de test antérieure migre sans perte des missions et décisions.
- **AC-L12-06 — Livraison fidèle :** version, révision, paquet, résultats de recette et limites sont cohérents.
- **AC-L12-07 — Pas de publication implicite :** aucun registre ni système de production n’a été modifié pour réaliser cette recette.

## Passation finale

Livrer le paquet local, son empreinte, la révision source, les instructions exactes d’installation et le rapport de recette. Fournir un exemple minimal pour lancer Avity Crew depuis un nouveau projet et un projet existant. Clore les lots uniquement selon les preuves ; conserver les blocages ouverts et les actions restantes lorsqu’un critère obligatoire manque.

