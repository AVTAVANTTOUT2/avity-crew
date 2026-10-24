# L07-T — Transport local et pont MCP

Préparation indépendante de L07, sans réservation ni déclaration d'acceptation du lot global. Auteur : sous-agent `/root/l00_provider_audit`, responsable de livraison `l07-transport`. Worktree `/Users/zeldris/.codex/worktrees/avity-crew-l07-transport`, branche `build/l07-transport`.

Base : `6cf2a4c06c9c6e919bb7fcfcbed6da9cbcc13c1b`. Source livrée : `5a8e23e0037696cf03c2cf8fd70ca7c8e2b7afee`. Worktree propre et `git diff --check 6cf2a4c..HEAD` réussi.

## Fichiers et API

Sept fichiers ajoutés uniquement : `packages/supervisor/src/{protocol,transport,client,mcp}.ts`, `tests/supervisor-transport.test.ts`, `tests/fixtures/supervisor/mcp-child.mjs`, `docs/PROTOCOL.md`.

`protocol.ts` définit `SupervisorApi`, `ToolDescriptor`, `AdminRequest`, `Endpoint`, options/handle du transport et options client. Signatures annoncées puis approuvées par le coordinateur :

- `startTransport({directory,project_id,registry,api})` → `{endpointFile,endpoint,close()}`.
- `new SupervisorClient({endpointFile,capability,timeout_ms?})` → `tools(runId)`, `execute(ToolCall)`, `admin(AdminRequest)`.
- `runMcpBridge({client,runId,input?,output?})`, `runMcpFromEnv()`.
- `SupervisorApi.tools(principal,runId)`, `execute(principal,call)`, `admin(principal,request)` ; métier injecté, Principal issu exclusivement de `CapabilityRegistry.authenticate`.

Aucun changement à `capabilities.ts`, Store, schémas/contrats, manifests, lockfile, exports partagés, serveur métier, CLI principale ou scheduler. Aucune dépendance ajoutée, aucun fournisseur LLM ni sous-agent lancé.

## Comportements livrés

HTTP sur `127.0.0.1:port0`, authentification Bearer, projet/run/méthode contraints, validation du contrat ToolCall, admin uniquement user. Réauthentification après lecture du body pour constater une révocation intervenue pendant sa réception. Le body ne fournit jamais Actor au transport.

Lock principal O_EXCL, garde de démarrage O_EXCL sérialisant les récupérations stale, nonce propre au service, fichiers privés. Métadonnées `endpoint.json` sans secret, `owner.key` séparé et géré par le registre. PID vivant/inaccessible ou propriété ambiguë refusés ; ancien PID confirmé ESRCH récupérable. Nettoyage de fermeture limité au nonce possédé.

Client relisant l'endpoint pour chaque appel, URL littérale loopback uniquement, aucun redirect, token en header/ENV et aucune relance aveugle. Bornes 1 MiB JSON/lignes MCP, 8 KiB métadonnées, réception/deadline client 10 secondes par défaut. Erreurs publiques sans message/détail brut susceptible de contenir une capability.

Pont MCP stdio JSON-RPC, stdout protocole uniquement, handshake connu **2025-11-25**, `tools/list` et `tools/call` vers le même client. InputSchema doit être fourni par le métier avec l'enveloppe complète sans method. Le nom d'outil fixe method ; l'appelant fournit request_id et idempotency_key séparément, sans les déduire d'un id JSON-RPC.

## Vérifications réelles hors LLM

| Commande | Résultat |
|---|---|
| `npm ci` | code 0, aucune vulnérabilité signalée par npm |
| `npm run check` | code 0 : typage, Prettier, build et **65 tests réussis** sur Node 26.12.0, dont 8 transport |
| `npm exec --yes --package=node@24.22.1 -- node --test dist/tests/supervisor-transport.test.js` | code 0 : **8 tests réussis** sur Node 24.22.1, exécutés après le commit final |
| `git diff --check 6cf2a4c..HEAD` | code 0 |

Les contrôles Node 26 ont porté sur l'état de code ensuite commité sans modification en `5a8e23e`. Les tests ouvrent de **vrais sockets HTTP**, des bases **SQLite temporaires réelles**, et un **processus Node MCP stdio réel**. Les callbacks métier sont explicitement des callbacks de test et n'implémentent pas le moteur Avity Crew. Leur table SQLite vérifie une déduplication structurelle du ToolCall, indépendante de l'ordre des clés JSON.

Couverture : deux clients concurrents ; mauvaise capability ; autre run ; méthode non exposée ; Actor ajouté au body ; admin agent refusé ; user du mauvais projet refusé ; exception métier contenant la clé owner sans fuite ; révocation SQLite, également pendant réception du body ; double instance ; démarrages concurrents sur ownership stale ; lock vivant/ambigu préservé ; changement de nonce non supprimé ; client réutilisé après redémarrage ; JSON invalide/trop grand/stream chunked ; déconnexion ; échéance et résultat potentiellement inconnu ; endpoint distant refusé avant connexion.

Le processus MCP est configuré par ENV. Sa sortie ne contient que des objets JSON-RPC et aucune capability. Version inconnue demandée → version connue retournée. Deux appels avec même id JSON-RPC et clés différentes restent distincts ; fallback client du premier appel → même enveloppe/identité et aucune nouvelle mutation dans la table de test. Appel incomplet sans idempotency_key refusé. Input non initialisé, malformé et trop grand produit des erreurs de protocole bornées.

## Sources, portée et limites

Pages officielles effectivement récupérées/examinées : lifecycle et transports MCP **2025-11-25**. La page latest pointe sur **2026-07-28**, qui utilise un autre lifecycle ; cette révision n'est pas revendiquée par ce bridge initialize. Les liens exacts sont dans `docs/PROTOCOL.md`.

Le garde de démarrage interrompu ou ambigu est conservé pour réconciliation explicite ; il n'est pas retiré spéculativement. Les règles de production métier, le fencing transactionnel à l'effet, le processus détaché, la commande CLI et la recette avec de vrais providers restent au coordinateur/L07 et ne sont pas annoncés comme réalisés par ce sous-lot. Les outils disponibles et schémas développés proviennent de l'API métier. Le transport n'est pas un serveur MCP Streamable HTTP public : son HTTP est le protocole privé interne derrière le pont stdio.

NON EXÉCUTÉ : fournisseurs Claude/Codex réels, service détaché, Windows/Linux. Ces limites sont conservées ici sans présenter cette préparation comme la livraison complète de L07.
