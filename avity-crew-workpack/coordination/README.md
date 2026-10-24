# Registre du chantier

Ce dossier conserve la coordination des agents qui construisent Avity Crew.
Le fonctionnement complet et les commandes sont dans [COORDINATION.md](../COORDINATION.md).

| Élément | Autorité et usage |
| --- | --- |
| `lots.json` | Définition du backlog, de ses dépendances et de ses périmètres. Aucun lot n'y est déclaré achevé. |
| `STATE.json` | Créé par la première mutation du helper ; état officiel, journal, notes, passations et revues. Écriture exclusivement via le helper. |
| `.coordination.lock` | Verrou de système utilisé par le helper ; sa présence ne signifie pas qu'un processus est bloqué. |
| `notes/` | Documents détaillés éventuels ; leurs références sont à publier par `note`. |
| `handoffs/` | Fichiers sources éventuels de rapports, avec un nom unique par lot, agent et tentative. |
| `reviews/` | Fichiers sources éventuels de revues indépendantes. |
| `decisions/` | Décisions détaillées éventuelles avec leurs références dans le journal. |

Les fichiers JSON soumis sont copiés dans `STATE.json` avec des identifiants
uniques ; l'instantané enregistré fait foi. Modifier un fichier source ne
modifie jamais rétroactivement une passation. Les répertoires de documents
complémentaires ne constituent pas un deuxième registre.

## États

`todo` → `in_progress` → `in_review` → `accepted`.

Un lot en cours peut devenir `blocked`, puis reprendre. Une revue demandant des
corrections le replace en `in_progress`. Une réattribution explicite change le
propriétaire et le jeton sans supprimer les anciens résultats. L'état
`accepted` signifie que les critères du lot et les preuves requises ont été
contrôlés par un relecteur distinct ; il ne signifie pas automatiquement que
l'ensemble du produit est livré.

Le helper vérifie la cohérence des statuts avec les événements, propriétaires,
tentatives et rapports. Un lot accepté conserve `accepted_review_id` et
`accepted_revision` ; une simple modification manuelle de son statut est
refusée et ne débloque pas les dépendances. Un refus de livraison peut être
documenté même si un conflit de fusion empêche encore de créer un candidat
testable ; le format minimal se trouve dans `COORDINATION.md`.

## Au départ

L'archive est livrée sans `STATE.json` de développement : toutes les tâches sont
à faire. Le helper peut afficher cet état avec `status` sans initialiser le
registre. `init` est facultatif ; la première prise de lot initialise l'état.

Conserver une seule copie canonique du registre pour tous les agents. Les
worktrees qui développent le code utilisent le même chemin absolu via `--root`.
Après la session, préserver le registre et ses preuves avec le projet. Une
sauvegarde doit être prise après la fin d'une mutation ; ne pas tenter de
fusionner plusieurs `STATE.json` provenant d'exécutions indépendantes.

## Formats distincts

Les JSON `examples/build-handoff.json` et `examples/build-review.json` servent
au **chantier**. Les contrats `TaskSpec`, `ContextBundle`, `Handoff`, `CrewEvent`
et autres schémas du futur **produit Avity Crew** ont une autre portée. Le code
de production ne doit pas importer ce helper comme moteur définitif.
