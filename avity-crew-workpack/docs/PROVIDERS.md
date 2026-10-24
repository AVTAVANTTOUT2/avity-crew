# Intégrations Claude Code et Codex

## Objectif
Piloter les CLI officielles déjà installées, avec leurs connexions natives, dans le workspace attribué. Le futur produit ne reproduit pas les API privées des fournisseurs et n'exporte pas leurs jetons. Les capacités exactes dépendent de la version locale et doivent être éprouvées.

Les interfaces documentées et les liens primaires sont recensés dans [SOURCES.md](SOURCES.md). Ce document définit les obligations des adaptateurs ; les commandes ci-dessous sont des points de départ à vérifier.

## Contrat commun
Chaque provider reçoit un rôle, un modèle disponible, un ContextBundle, un répertoire, un identifiant de tentative et les outils de coordination permis. Il retourne des événements normalisés, un état final et son identifiant natif quand disponible.

Événements minimaux : session démarrée, message agent, outil démarré/terminé lorsque exposé, demande/refus de permission, usage si exposé, erreur classée et fin de processus. Ne pas déduire une réussite métier du code de sortie.

Séparer stdout structuré et stderr. Parser les fragments UTF-8 et les lignes JSON partielles avec limites de taille. Tolérer un événement inconnu en conservant sa forme expurgée et en signalant le défaut de compatibilité ; ne pas perdre les événements connus.

## Claude Code — L04
Base documentaire : mode non interactif `claude -p`, sortie `stream-json` avec options requises par la version, reprise par identifiant et consignes ajoutées au prompt. Utiliser une reprise exacte, jamais une sélection implicite de la dernière conversation en contexte multi-agent. [S-CLAUDE-HEADLESS, S-CLAUDE-CLI]

Par défaut, conserver les parcours d'authentification natifs autorisés. L'option `--bare` change le chargement de configuration et l'authentification ; ne pas l'ajouter comme simple optimisation si le besoin est d'utiliser la connexion d'abonnement. La documentation actuelle signale aussi la conservation du prompt système d'une session : les mises à jour de contexte doivent être transmises explicitement. [S-CLAUDE-HEADLESS, S-CLAUDE-CLI]

Vérifier en L04 :
- Statut de connexion sans lecture ni affichage des secrets.
- Modèle réellement sélectionné et identification fiable de session.
- Envoi initial, streaming, reprise, interruption et fermeture de l'arbre de processus.
- Ajout du bridge MCP via configuration de session maîtrisée, sans réécrire la configuration globale.
- Comportement lorsque les outils demandés ne sont pas autorisés.
- Contexte actualisé effectivement reçu lors d'un tour suivant.
- Deux sessions parallèles sans mélange des événements.

## Codex — L05
Base de V1 : `codex exec --json`, permissions adaptées au workspace et reprise ciblée par session. Cette interface conserve des événements exploitables et permet des tâches non interactives. L'App Server peut être retenu si ses capacités nécessaires sont vérifiées avec la version choisie ; figer ce choix dans l'ADR d'adaptateur. [S-CODEX-EXEC, S-CODEX-APP]

`codex exec` peut réutiliser l'authentification CLI. La configuration effective, les permissions et les fichiers d'instructions doivent être relevés sans divulguer les identifiants. Le mode d'édition doit être explicite : ne pas supposer qu'un lancement non interactif a le droit d'écrire. [S-CODEX-EXEC, S-CODEX-AUTH]

Le bridge de coordination est un serveur MCP **externe consommé par Codex**. Ne pas confondre cela avec l'ancienne commande hébergeant Codex comme serveur MCP ; vérifier les mécanismes actuels de configuration et les changements de version. [S-CODEX-MCP]

Vérifier les mêmes critères que Claude, ainsi que la distinction entre thread/session native, tour et tentative Avity Crew. Une erreur de quota, d'authentification ou de permission n'est pas un résultat vide réussi.

## Matrice de capacités
Produire `provider-capabilities.json` dans les preuves de L04/L05 :
- nom du provider, chemin du binaire, version, date de vérification ;
- capacités supported/unsupported/unverified ;
- méthode de reprise, méthode d'interruption et livraison des mises à jour ;
- comportement des permissions et niveau réel d'isolation ;
- support des outils MCP, du mode JSON et des données d'usage ;
- liste des scénarios réellement vérifiés, avec preuves expurgées.

Le parseur spécifique est versionné et testé sur fixtures représentatives. Une version inconnue peut être diagnostiquée, mais ne reçoit pas automatiquement le même niveau de garantie.

## Modèles et frais
Le modèle vient des options disponibles du fournisseur. Aucun modèle particulier n'est imposé comme exclusif. « Opus » est une préférence de chef lorsque disponible, pas une chaîne inventée passée sans vérification.

Afficher l'usage fourni par le CLI et distinguer consommation, estimation et montant facturé. Afficher « indisponible » si une donnée n'est pas exposée. Une limite fournisseur met le travail en attente ou déclenche une réattribution autorisée ; elle n'autorise pas un contournement.

## Séparation tests simulés et essais réels
Les tests de CI utilisent un exécuteur simulé qui produit événements fragmentés, erreurs, permissions et interruptions de façon déterministe. Les fixtures doivent être expurgées. Le nom `fake` et la mention `simulated` apparaissent dans le contexte de test.

Une recette live est exécutée localement sur un petit projet isolé, avec les comptes et quotas de l'utilisateur autorisés. Elle doit inclure Claude chef + Codex exécutant, puis Codex chef + Claude exécutant. En l'absence d'accès, conserver un statut bloqué/live_unverified et détailler la commande à exécuter plus tard.

## Ce qui n'est pas promis
Les reprises de conversations arbitraires déjà ouvertes, le transfert exact des historiques natifs entre machines et l'injection instantanée dans une commande en cours dépendent des interfaces. La V1 sait gérer les sessions qu'elle démarre et préparer un dossier de reprise lorsqu'une reprise native est impossible.

