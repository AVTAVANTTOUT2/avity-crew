# Références primaires et règles de vérification
Consultation de référence : **24 octobre 2026**. Les sources établissent l'existence d'interfaces documentées ; les lots L00/L04/L05 vérifient leur comportement avec les versions présentes. Les décisions d'architecture du dossier sont des propositions originales, pas des fonctionnalités déjà livrées.

| ID | Source | Usage limité dans ce dossier |
|---|---|---|
| S-NODE | [Node.js Releases](https://nodejs.org/en/about/previous-releases) | Choix de Node.js 24 LTS comme base initiale. Figer un patch supporté lors de L00. |
| S-CLAUDE-HEADLESS | [Run Claude Code programmatically](https://code.claude.com/docs/en/headless) | Lancement non interactif, événements structurés et comportement du mode bare. |
| S-CLAUDE-CLI | [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) | Reprise ciblée, options, modèle et comportement des prompts de session. |
| S-CLAUDE-AUTH | [Claude Code Authentication](https://code.claude.com/docs/en/authentication) | Connexions natives autorisées. |
| S-CLAUDE-MEMORY | [Claude Code memory](https://code.claude.com/docs/en/memory) | Chargement des instructions et distinction contexte/configuration imposée. |
| S-CODEX-EXEC | [Codex non-interactive mode](https://developers.openai.com/codex/non-interactive-mode) | Sortie JSONL, reprise, authentification et permissions de lancement. |
| S-CODEX-APP | [Codex App Server](https://developers.openai.com/codex/app-server) | Intégration plus riche optionnelle à valider par version. |
| S-CODEX-AUTH | [Codex authentication](https://developers.openai.com/codex/auth) | Distinction connexion compte et authentification API. |
| S-CODEX-MCP | [Codex MCP](https://developers.openai.com/codex/mcp) | Connexion de Codex aux outils externes de coordination. |
| S-GIT | [git-worktree](https://git-scm.com/docs/git-worktree) | Espaces de travail et branches distincts d'un même dépôt. |

## Comment utiliser ces sources
Lire la page pertinente et l'aide du binaire installé, puis documenter le résultat observé dans une matrice de capacités. Ne pas copier de grands passages de documentation dans les prompts. Les mécanismes non vérifiés restent indiqués comme tels.

Les documents évoluent. Une incompatibilité justifiée conduit à mettre à jour l'adaptateur, ses tests et la décision de version. Elle ne justifie ni un appel à une API privée ni une désactivation globale des permissions.

Les exemples de ce dossier utilisent des identifiants fictifs. Aucun compte, secret, dépôt client ni modèle payant n'a été testé pour produire cette archive.

