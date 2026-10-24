# Revue indépendante L07 — transport

Relecteur : `/root/l05_codex`, indépendant de l'auteur transport `/root/l00_provider_audit`. Révision examinée : **`ccbab6f1551c2f54056bece878b229377f1ef52f`**, dans `/Users/zeldris/avity-crew`, le 24 octobre 2026. Revue bornée, sans modification produit ni changement de statut du lot.

**Aucun finding bloquant ou correctif concret établi dans le périmètre transport examiné.** Cette conclusion porte sur la propriété locale, l'authentification, le routage HTTP/MCP et leurs raccordements immédiats ; elle ne prononce pas l'acceptation complète de L07.

## Contrôles de code

Lecture de `transport.ts`, `client.ts`, `mcp.ts`, `protocol.ts`, `capabilities.ts`, des ACL dans `tools.ts`, et des points de revalidation de `Coordinator.execute`, puis des tests correspondants. Lot L07 et preuves antérieures `transport-checks.md` / `transport-handoff.json` consultés comme contexte ; leurs résultats historiques ne sont pas attribués à cette révision.

- La propriété repose sur deux créations exclusives, le garde `supervisor.starting` et `supervisor.lock`. Une propriété vivante/inaccessible ou ambiguë est refusée. La récupération exige un PID confirmé disparu ; fermeture et nettoyage comparent le nonce possédé. L'endpoint est publié par renommage, sans capability.
- Les fichiers privés, liens symboliques, permissions et tailles sont contrôlés. Le serveur écoute `127.0.0.1`, vérifie Host/Origin et authentifie la capability. Il réauthentifie après réception du body. Projet, run, méthode autorisée et contrat strict sont vérifiés ; un Actor libre et l'admin agent sont refusés.
- La capability d'agent revalide tâche/rôle/tentative/génération. Le principal contient un contrôle réexécutable après attente dans la file ; le coordinateur l'appelle avant mutation, et les effets asynchrones ont leurs gardes spécifiques. L'authentification initiale seule n'est donc pas considérée comme une autorisation durable.
- Le client relit l'endpoint à chaque appel, refuse endpoint distant/redirect et borne réception et échéance totale. Il ne rejoue pas une mutation après perte de réponse. Les erreurs publiques n'incluent pas les exceptions brutes.
- MCP utilise le même client, un run fixé et le contrat ToolCall complet. Le nom fixe la méthode ; les clés de requête/idempotence ne sont pas dérivées de l'id JSON-RPC. Le lifecycle déclaré est 2025-11-25 ; stdout reste protocolaire, borné, avec backpressure. Les annotations des mutations gardent `readOnlyHint: false`.

## Vérifications exécutées sur le candidat

`node --test dist/tests/supervisor-transport.test.js dist/tests/cli.test.js dist/tests/capabilities.test.js`, Node **26.12.0** : **23/23 réussis, 0 échec, 0 skip**, exit 0. Les huit tests transport utilisent de vrais sockets, SQLite et un processus MCP Node ; les callbacks métier restent explicitement simulés. Ils couvrent notamment deux clients, identité forgée, droits croisés, révocation pendant réception, singleton, nonce, récupération stale, limites JSON, déconnexion/deadline et reprise du client après redémarrage.

Sonde supplémentaire sans modèle : deux processus CLI `init --json` simultanés dans un projet neuf avec espaces, sous un `XDG_DATA_HOME` jetable. Les deux ont retourné exit 0 / `ok:true`; `status` et `service status` ont retrouvé le même projet. `service stop` a retourné exit 0, puis la disparition effective du PID de ce service a été observée avant suppression du laboratoire. Aucun objectif créé, aucun provider LLM lancé.

## Limites

La suite ciblée n'est pas une recette native Claude/Codex sur le candidat final et ne valide pas tous les critères métier de L07. Les protections de fichiers sont examinées dans le cadre d'un usage personnel local ; elles ne constituent pas une séparation entre acteurs partageant le même compte OS. Linux/Windows, panne électrique et nouvelle version du lifecycle MCP non qualifiés ici. Node 24 n'a pas été rejoué par ce relecteur pour cette mission ; la racine en assure le contrôle combiné. Les fichiers non suivis présents avant revue ont été préservés.
