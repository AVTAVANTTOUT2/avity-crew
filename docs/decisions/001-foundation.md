# 001 — Socle et frontières

Décision du coordinateur, L00, 24 octobre 2026.

Le dossier est neuf ; construire Avity Crew à la racine et conserver le workpack
comme spécification et registre du chantier. Branche d'intégration :
`build/avity-crew`. Chaque piste de code parallèle reçoit un worktree et une
branche ; les contrats, dépendances, lockfile et changelog ont un seul auteur.

Utiliser TypeScript strict, modules ESM, npm workspaces et Node 24 LTS de
référence. Node 26 installé sera également testé. Les versions directes npm
seront exactes et le lockfile commis. Les modules sont `packages/contracts`,
`core`, `storage`, `context`, `providers`, `workspace`, `supervisor`, et `apps/cli`.
Les imports internes sont relatifs ; un build racine conserve cette topologie
dans `dist`, que le paquet racine peut emporter sans chemins de développement.
Les sous-packages sont privés ; seul le paquet racine est installable.

SQLite est fourni par `node:sqlite`, driver du runtime Node, sans installation
native tierce. Son statut et sa disponibilité sont vérifiés sur Node 24 avant
acceptation du stockage. Transactions et migrations restent obligatoires.
Référence : https://nodejs.org/docs/latest-v24.x/api/sqlite.html.

Le superviseur possède les processus et écrit l'état. Transport de référence :
HTTP sur boucle locale avec port attribué par le système et capacité privée par
projet/rôle ; ne jamais incorporer la capacité dans le contexte des prompts.
Le bridge MCP stdio relaie ce transport. La TUI utilise le terminal et readline
natifs pour limiter les dépendances ; mode JSON et commandes non interactives
accèdent à la même API. Aucun faux succès pour les fonctions encore absentes.

L01 conserve les noms/champs du schéma runtime initial. La validation JSON à la
frontière utilise Ajv 2020 et formats ; les types sont générés depuis le schéma
pour éviter une seconde définition manuelle divergente. Les événements natifs
restent confinés aux adaptateurs. Les modes `fake`, `simulated`, `static` et
`live` restent explicites. Les permissions et connexions natives sont conservées.

Commandes communes prévues : `npm ci`, `npm run build`, `npm run typecheck`,
`npm test`, `npm run check`, `npm pack`. CI initiale sans secret fournisseur.
Les interfaces réellement disponibles guident les adaptateurs ; aucune capacité
de reprise ou d'entrée pendant un tour n'est supposée sans vérification.

Ni publication npm, ni push, ni déploiement ni production n'est inclus.
