# L00 — Audit initial, 24 octobre 2026

Responsable : codex-coordinator. Racine produit et future branche d'intégration :
`/Users/zeldris/avity-crew`, `build/avity-crew`. Workpack canonique :
`/Users/zeldris/avity-crew/avity-crew-workpack`.

## Faits observés

Au premier examen, la racine contenait uniquement `.DS_Store` et le workpack.
`git status --short --branch` échouait : aucun dépôt Git. Aucune application,
dépendance npm, CI ni modification de code utilisateur à reprendre. Le workpack
est conservé. Serena a créé sa configuration locale. Le bootstrap a été examiné
en mode plan puis appliqué : relais AGENTS.md, CLAUDE.md, agent.md et exclusions
de l'état local. Git a été initialisé pour les worktrees et révisions exigés.

Environnement observé : macOS arm64 ; Node 26.12.0, npm 11.20.0, Python 3.15.0,
Git 2.56.0, Claude Code 2.1.304, Codex CLI 0.163.0. Les binaires fournisseurs
sont disponibles. Voir `providers.md` et `provider-capabilities.json` pour les
statuts natifs, les interfaces inspectées et les petits essais live séparés.
Les secrets restent gérés par les logiciels officiels.

Deux sessions indépendantes ont reçu des missions L00 :
`/root/l00_provider_audit` (interfaces et disponibilité) et
`/root/l00_acceptance_map` (critères et dépendances). Le coordinateur conserve
la propriété du lot, des contrats, du lockfile, du changelog et de l'intégration.
La capacité de délégation de cette session est de quatre agents, responsable
compris ; le produit devra néanmoins gérer la concurrence configurable prévue.

## Cadrage retenu

Voir `docs/decisions/001-foundation.md`. Il n'y a pas d'autre produit à isoler.
Avity Crew est construit à la racine. Le scénario Transport est une fixture.
Les treize lots et leurs dépendances restent inchangés. L01 précède les trois
pistes L02, L04 et L05 ; L03/L06 suivent L02. Les préparations indépendantes
ne valent jamais acceptation d'une dépendance.

## Vérifications exécutées

- `python3 avity-crew-workpack/scripts/test_coordination.py` : 20 tests, exit 0.
- `python3 avity-crew-workpack/scripts/test_bootstrap.py` : 8 tests, exit 0.
- `python3 avity-crew-workpack/scripts/validate_pack.py` : exit 0 ; 14 JSON,
  177 liens, 6 exemples et 3 sondes négatives vérifiés.
- Bootstrap : plan puis application réussis ; aucun fichier existant remplacé.
- Versions et aides de coordination/bootstrap/fournisseurs inspectées.

Ces résultats vérifient le dossier de construction, pas le futur produit.
Les preuves de produit, MCP, permissions, sessions concurrentes, arrêt/reprise,
intégration et installation appartiennent aux lots suivants. Linux/WSL ne sont
pas disponibles dans cet environnement et resteront explicitement non vérifiés
tant qu'aucune preuve sur ces systèmes n'est obtenue.

## Passation L01

Créer les contrats exécutables à partir du schéma runtime du workpack, une
simulation explicitement identifiée, les commandes build/typecheck/test/check,
la CLI d'aide et une CI sans compte fournisseur. Vérifier Node 24 comme
référence et Node installé séparément. Faire relire chaque livraison sur sa
révision, puis utiliser le registre canonique pour accepter le lot.
