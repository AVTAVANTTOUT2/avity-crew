# L09-CLI — Préparation de l'interface terminal

Auteur `/root/l00_provider_audit`, rôle `l09-cli`. Aucun claim L09 : cette préparation ne déclare pas la recette du lot intégrée. Worktree `/Users/zeldris/.codex/worktrees/avity-crew-l09-cli`, branche `build/l09-cli`.

Base : `01448d042f1018ba8a7cf07566b1d69f186e84e0`. Livraison : `89e35f88bc2c133708573c6be833499d80d5989b`, complétée par `cc13943e8fe96d8614b82c57a133095e83ff1f20` pour l'activité et la conversation effectivement exposées par le runtime. Le worktree est propre ; seuls huit fichiers autorisés ont changé : `apps/cli/src/{main,args,service,view}.ts`, `tests/cli.test.ts`, `tests/fixtures/cli/{service.mjs,terminal_driver.py}`, `docs/CLI.md`.

## Résultat

CLI async réelle raccordée à `SupervisorClient` : init/run, statut/liste, attach/watch, réponse liée à une question, message ciblé, pause/reprise/arrêt, remplacement du chef, réattribution, inspection du contexte, export, doctor, service et canaux internes. Les options et critères sont validés avant metadata/processus. Objectif naturel, fichier UTF-8 ou stdin ; aucun objectif n'est transféré en argv au service.

Le service est démarré détaché via le chemin compilé du paquet, avec uniquement `--project` et la racine réelle, journal privé append et attente d'endpoint sain. Les variables de capability de session sont retirées de cet enfant ; owner.key reste lu dans un canal privé. Aucun modèle n'est lancé par le code de démarrage de la CLI.

Wizard TTY : diagnostic du service, collage multiligne, critère observable obligatoire, chef/modèle facultatifs, puis attachement au Run directement retourné par create_run (contrat confirmé par le coordinateur). La vue garde la saisie pendant les événements et le redimensionnement, protège ANSI/OSC, découpe les graphèmes, distingue tâches/sessions/tours/attentes, affiche la conversation provider.text et uniquement les usages déclarés connus. Le cache de conversation est borné à 20 messages ; le journal complet reste dans le service.

La vue sans run explicite se fixe sur la première identité observée. Le curseur n'avance qu'après présentation de page, la reconnexion ne crée pas d'objectif et une erreur transitoire reste `ok:false`. q/CtrlC détachent seulement. Les sorties JSON v1 et les codes 0/1/2/3/4/5/130 sont décrits dans docs/CLI.md ; une requête acceptée n'est pas annoncée comme recette réussie.

## Contrats préservés

Le message utilisateur passe par ToolCall send_message avec la version courante du run, request_id/idempotency_key explicites, source_ids vide et requires_ack vrai. Le destinataire chef est chief:current, résolu par le métier. Les méthodes admin et leurs arguments sont ceux convenus ; create_run retourne Run avec id. Les canaux internal call/MCP utilisent ENV et la même enveloppe, sans lecture owner.key dans internal call.

Aucun bin, manifest/lockfile, contrat, Store, module supervisor, scheduler ou provider n'a été modifié. Aucun sous-agent ni provider LLM lancé. Le runtime/service de production est la propriété du coordinateur.

## Vérifications

| Commande | Résultat |
|---|---|
| `npm ci` | code 0 ; aucune vulnérabilité signalée par npm |
| `npm run check` | code 0 : typage, format, build et **101 tests réussis** sur Node 26.12.0 |
| `npm exec --yes --package=node@24.22.1 -- node --test dist/tests/cli.test.js` | code 0 : **11 tests CLI réussis**, aucun skip, sur Node 24.22.1 |

Ces contrôles ont porté sur l'état de code commité ensuite sans modification en `cc13943e`. Les subprocess CLI, sockets HTTP, SQLite et PTY sont réels ; les callbacks métier et providers sont explicitement **fake**, sans prétention de collaboration LLM réelle.

Couverture : parsing refusé avant création de datahome/Git ; cwd distinct de l'installation et chemin avec espaces ; un seul create_run ; objectif/critères/contraintes conservés, shell non interprété ; lecture fichier et stdin Unicode ; toutes les routes de contrôle et arguments ; question référencée ; message enregistré queued sans prétendre delivered ; internal call inchangé avec identité issue du cap ; internal MCP stdout uniquement JSON-RPC ; indisponibilité/reconnexion avec erreur structurée et curseur sans doublon ; pas de nouveau run/stop lors du détachement ; codes d'attente/failure/completion/cancel ; lancement détaché réel de fixture avec log 0600 et aucun cap/objectif dans argv/journal ; nettoyage ANSI/OSC et clip Unicode valide.

Trois parcours **PTY POSIX** effectivement exécutés :

1. Saisie partielle `brouillon é🧪`, arrivée d'événements, redimensionnement 36→18 colonnes, envoi intact, q, service encore joignable.
2. Ctrl+C dans la vue : code 130, aucun stop/shutdown adressé au moteur.
3. Wizard : collage simultané d'un objectif sur deux lignes, critère explicite, choix config, create_run unique, vue maintenue jusqu'à q.

## Portée restante de l'intégration

NON EXÉCUTÉ dans cette préparation : collaboration Claude/Codex via le runtime intégré, parcours manuel de recette produit et plateformes Linux/Windows. La fixture service n'est pas le runtime de production. Ces vérifications appartiennent à l'intégration L08/L09 et à la recette L11 ; les commandes existent et n'annoncent pas un succès lorsqu'un service/provider est indisponible. Le chemin de main.js est défini par le contrat du coordinateur et sera fourni par son lot runtime.
