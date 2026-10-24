# Contre-revue ciblée du runtime L07

What this change does: le candidat corrige les cinq défauts documentés dans `runtime-review.md` : lancement après pause, relance d'une tâche en attente utilisateur, statut trop volumineux, résolution des sources historiques et chemin du pont MCP.

**Candidat :** `9dd354fb3981749c0cc0bc98cea85cd882586c2a`.

**Verdict : les cinq constats sont levés dans le périmètre vérifié. Aucun défaut bloquant restant confirmé parmi ces cinq constats.** Ce verdict ne constitue pas l'acceptation de l'ensemble du lot L07, ni une qualification native Claude/Codex ou de toute la résilience processus ajoutée parallèlement.

Revue en lecture seule des sources produit. Seul ce rapport est écrit. Les probes utilisent des répertoires et une base SQLite temporaires nettoyés après exécution. Aucun sous-agent, modèle ou CLI fournisseur n'est lancé. Les fournisseurs des scénarios sont explicitement simulés.

## Vérifications exécutées

Commande rejouée indépendamment :

```text
/opt/homebrew/Cellar/node/26.12.0/bin/node --test dist/tests/runtime.test.js
exit 0 — 6 tests, 6 réussis, 0 échec
```

Les six scénarios présents dans le candidat couvrent documentation et reprise de conversation à une place, question ciblée et tâche indépendante, réponse HTTP perdue/rejeu idempotent, deux workspaces Git avec promotion après revue, correction après `changes_requested`, et pause pendant le probe fournisseur.

Le JavaScript local de `packages/supervisor/src/runtime.ts` a été comparé à l'émission ESM du TypeScript extrait de `9dd354f` avec les options du dépôt : identité octet pour octet. Les probes complémentaires ci-dessous utilisent ce runtime ; la copie du paquet sous un autre chemin conserve ses imports et dépendances locales. Aucun build global ni génération de contrat n'a été exécuté par cette contre-revue.

| Constat initial | Correction examinée dans 9dd354f | Preuve exécutée et résultat |
| --- | --- | --- |
| **1. Lancement après pause** | Compteur d'annulation par run/sujet, contrôle du statut/génération avant et après le probe puis immédiatement avant `start`/`resume` ; inscription dans `active` dès le retour synchrone du lancement, avant l'observation asynchrone du PID. Runtime:518–586, 792–815, 1397–1406. | Le test HTTP avec `probe` derrière une barrière reçoit `paused`, libère ensuite la barrière, attend le scheduler et constate **zéro tour démarré**, run toujours `paused`, aucune erreur fake. La fenêtre initialement reproduite est fermée. |
| **2. Question bloquante sur tâche prête** | Questions ouvertes filtrées avant enqueue et recontrôlées à l'entrée du worker ; portée globale si aucune tâche n'est renseignée, sinon portée ciblée. Runtime:233–244 et 364–375. | Le scénario HTTP/SQLite maintient la tâche concernée en attente, exécute la mission indépendante et affirme l'absence de `turn.launch_failed`, puis conserve la réponse utilisateur réelle pour la suite. Pas de boucle de refus/relance observée. |
| **3. Statut accumulant les contextes** | `status` sert au plus vingt résumés de contexte, sans `layers`, avec compteur ; autres collections limitées. Le détail reste exposé par `inspect_context`. Runtime:1197–1235. | Vingt ContextBundle valides représentant **1 362 660 octets** en forme complète : réponse HTTP **8 275 octets** avec `limit:1`, **16 319 octets** avec la limite par défaut. Les vingt résumés n'ont pas de `layers` et `inspect_context` restitue exactement le dernier bundle persisté. |
| **4. Sources historiques absentes du worker** | Troisième argument `Store.records<SourceRef>(run.id, 'source')` transmis à `selectTaskSources`. Runtime:608–614. | Source sélectionnée dans une première racine, SourceRef sauvegardé puis référencé par une tâche exécutée dans une seconde racine. L'appel réel de `turn` atteint la frontière fake avec le contenu actuel dans le prompt ; le SourceRef du contexte est rebasé et l'historique original reste conservé. Aucun `CONTEXT_SOURCE_MISSING`. |
| **5. Chemin MCP encodé** | `fileURLToPath(new URL('./bridge.js', import.meta.url))`. Runtime:776. | Modules compilés copiés dans `install é`, dépendances locales réutilisées ; capture de l'argv construit par le runtime puis lancement réel de ce pont Node. **initialize** sur `2025-11-25` et **tools/list** authentifié réussissent : huit outils autorisés, **exit 0**, stderr vide, stdout exclusivement JSON-RPC. |

Le probe de source utilise un `start` fake qui capture la demande puis lève un marqueur contrôlé : il prouve la sélection, la compilation et la remise de la demande, sans prétendre avoir exécuté un tour LLM complet. Le pont MCP est un vrai processus Node utilisant le transport HTTP et les capacités réels ; son token reste uniquement dans l'environnement, jamais dans l'argv ou dans ce rapport.

Sur macOS, Node canonicalise `/var/...` en `/private/var/...` lors du chargement ESM. La comparaison lexicale brute de ces deux préfixes diffère ; un probe séparé confirme l'égalité de leurs `realpath` et la conservation de l'espace et du caractère Unicode. Le lancement MCP effectif ci-dessus confirme que le chemin généré désigne bien le module existant.

## Limites du verdict

- Les changements plus larges de réconciliation de processus, l'identité du PID et les politiques de reprise explicite intégrés autour de `5ff…` / `643d8b9` ne sont pas qualifiés exhaustivement ici. Ils demandent leurs propres tests de crash, propriété du processus, reprise et arrêt. Ils ne sont pas ajoutés artificiellement aux cinq défauts initiaux.
- Le fencing est revu sur les chemins communs pause/stop/remplacement/fermeture ; la régression exécutée ici porte sur la pause pendant `probe`. Chaque combinaison d'interruption à chaque étape de préparation n'a pas été rejouée séparément.
- L'accumulation de contextes est vérifiée à vingt bundles volumineux, avec lecture ciblée exacte. Ce probe ne démontre pas une pagination exhaustive au-delà de la limite de lecture des records Store, ni une borne de taille pour toute combinaison arbitraire de grandes tâches/décisions/événements.
- Node observé et exécuté : **26.12.0**. Node 24, lint/typecheck/suite globale, fournisseurs natifs, paquet de release installé et publication : **NON EXÉCUTÉS dans cette contre-revue** ; ces preuves restent distinctes des six tests et des probes décrits ci-dessus.

La régression persistante de statut volumineux est préparée par l'agent E2E dans son périmètre ; cette contre-revue apporte déjà sa preuve indépendante HTTP/SQLite et laisse au coordinateur son intégration et la validation finale de l'état combiné.
