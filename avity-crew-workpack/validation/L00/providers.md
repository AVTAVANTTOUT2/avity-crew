# L00 — Audit des fournisseurs locaux

Date : 24 octobre 2026. Auteur : sous-agent identifiable `l00_provider_audit`, propriétaire L00 : coordinateur. Révision de départ : aucun dépôt Git initial à la racine ; cet audit ne modifie ni authentification ni configuration globale.

## Observations locales

| Fournisseur | Binaire | Version | Connexion native observée |
|---|---|---|---|
| Claude Code | `/opt/homebrew/bin/claude` | `2.1.304` | `claude auth status` : connecté, méthode `claude.ai` |
| Codex | `/Users/zeldris/.local/bin/codex` | `0.163.0` | `codex login status` : connecté avec ChatGPT |

Les commandes de version, `--help`, `claude auth --help`, `claude mcp --help`, `codex exec --help`, `codex exec resume --help` et `codex app-server --help` ont réellement été exécutées avec succès. Aucune donnée de compte ni secret n'est conservé ici.

L'aide locale confirme pour Claude : `-p`, `--output-format stream-json`, `--verbose`, `--include-partial-messages`, `--input-format stream-json`, `--resume <id>`, `--session-id <uuid>`, `--mcp-config`, `--strict-mcp-config`, `--permission-mode`, `--permission-prompts none`, `--tools`, `--allowedTools`, `--model`. Pour Codex : `exec --json`, prompt stdin via `-`, `exec resume <SESSION_ID> -`, `--sandbox`, `-c`, `--ignore-user-config`, `--skip-git-repo-check`, configuration MCP par session. `codex exec resume` n'expose pas `--sandbox` dans son aide : une reprise doit conserver la politique de la session ou la fournir par configuration documentée (`-c sandbox_mode="read-only"` dans l'essai ci-dessous).

## Sources officielles consultées

- [Claude Code programmatique](https://code.claude.com/docs/en/headless) : flux JSON, stdin, reprise exacte, refus de permissions sans interlocuteur.
- [Référence CLI Claude Code](https://code.claude.com/docs/en/cli-reference) : options et distinction prompts/configuration.
- [Codex non interactif](https://developers.openai.com/codex/non-interactive-mode) : événements JSONL, stdin, reprise par identifiant précis.
- [Codex MCP](https://developers.openai.com/codex/mcp) : configuration des serveurs stdio/HTTP et permissions d'outils.

Ces pages ont été effectivement récupérées, puis les passages utiles examinés. Les sources établissent une interface documentée ; elles ne remplacent pas les essais locaux.

## Essais live minimaux exécutés

Les processus ont reçu leurs arguments comme tableau et leur prompt sur stdin, depuis `/private/tmp`. Aucun outil ni fichier n'était demandé. Un délai maximal de 45 secondes et un SIGTERM de garde étaient prévus ; aucun délai n'a expiré.

Claude a été lancé avec `-p --output-format stream-json --verbose --tools '' --permission-mode dontAsk --permission-prompts none --strict-mcp-config --mcp-config '{"mcpServers":{}}'`. Résultat `AVITY_CREW_L00_OK`, code 0, `is_error: false`. Session : `4b7fdb1c-d058-4dc4-a1e0-2a627e1735c2`. Modèle réellement annoncé : `claude-opus-5-5` (configuration native, aucun modèle imposé).

La reprise `--resume 4b7fdb1c-d058-4dc4-a1e0-2a627e1735c2` avec les mêmes options a retourné `AVITY_CREW_L00_24 DELTA_24`, code 0, même identifiant. Le premier mot provenait du tour antérieur et le second du nouveau contexte transmis.

Codex a été lancé avec `exec --ignore-user-config --sandbox read-only -c 'approval_policy="never"' --json --skip-git-repo-check -`. Résultat `AVITY_CREW_L00_OK`, code 0. Thread : `01a16d78-ed26-7700-a822-800d5a353153`. Événements observés : `thread.started`, `turn.started`, `item.completed`, `turn.completed`. Le modèle n'était pas exposé par ces événements ; il reste non identifié pour cet essai.

La reprise `exec resume --ignore-user-config -c 'approval_policy="never"' -c 'sandbox_mode="read-only"' --json --skip-git-repo-check 01a16d78-ed26-7700-a822-800d5a353153 -` a retourné `AVITY_CREW_L00_24 DELTA_24`, code 0, même thread.

Les événements Claude observés comprenaient `system`, `assistant`, `rate_limit_event`, `result`. Un événement de limite n'est pas à lui seul un échec : ce tour a produit un résultat réussi. Une fin de tour provider n'est pas une livraison acceptée par Avity Crew.

## Contrat conseillé aux lots suivants

1. Utiliser les CLI officielles avec `spawn(binary, argv)` et stdin, sans concaténer le prompt dans une commande shell. Conserver stderr séparé du protocole stdout.
2. Décoder JSONL incrémentalement, supporter les lignes fragmentées et inconnues, borner les tampons et normaliser session/tentative/message/outil/erreur/usage sans inventer de données.
3. Capturer `session_id` Claude et `thread_id` Codex immédiatement. Ne jamais reprendre « la dernière session ». Fournir explicitement le nouveau contexte d'équipe à chaque continuation.
4. Fournir un bridge MCP par session. Claude propose une configuration JSON en argument ou fichier et `--strict-mcp-config`. Codex propose des overrides `-c` de `mcp_servers.<nom>` ; valider concrètement l'appel à L04/L05. Aucune réécriture de configuration globale n'est nécessaire.
5. Ne pas utiliser `--bare` avec la connexion Claude native observée : l'aide avertit que ce mode n'utilise pas OAuth. Ne pas copier les caches de connexion. `--ignore-user-config` Codex conserve l'authentification native mais retire les préférences utilisateur ; c'était un choix d'isolation de cet essai, pas une obligation du produit.
6. Garder modèle et permissions configurables. Aucun essai n'a utilisé de bypass. Un outil refusé, une interruption ou un code de sortie non nul doit devenir un état explicite ; ne pas assimiler un processus arrêté à un succès métier.

## Limites et passation

Réussi : découverte des CLI, statut de connexion, échanges live structurés, reprise exacte avec contexte nouveau pour les deux fournisseurs.

NON EXÉCUTÉ à L00 : appel MCP réel, modification effective de code, deux sessions simultanées du même fournisseur, demandes de permission, interruption graduelle/arbre de processus, quota/réseau en échec, gros flux/fragmentation et App Server. Les lots L04/L05 portent ces preuves. Aucun succès live produit Avity Crew n'est revendiqué.

Fichiers livrés : ce rapport et `validation/L00/provider-capabilities.json`. Aucun autre fichier, aucun commit, aucune configuration native n'ont été modifiés par cette sous-tâche.
