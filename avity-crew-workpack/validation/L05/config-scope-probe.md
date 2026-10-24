# L05 — Diagnostic natif du périmètre MCP

24 octobre 2026, l05-codex. Source applicative inchangée git:f1d594a488438dbee12f546f4bdab28a44b42c9b. CLI installée : /Users/zeldris/.local/bin/codex, 0.163.0. Diagnostics exclusivement sans LLM et sans démarrer de serveur MCP : codex -c ... mcp list --json, aide locale et features list. Aucun config utilisateur modifié, CODEX_HOME inchangé, aucun cache d'auth copié ; aucune valeur d'env ou de credentials imprimée ni archivée.

## Résultats observés

Les compteurs actifs filtrent enabled !== false. Les premières sondes comptaient tous les serveurs configurés, dont deux désactivés : ne pas confondre 10 configurés avec 8 actifs.

| Overrides de recette | hasAmbient actif | hasCrew actif | otherCount actif |
| --- | --- | --- | --- |
| ambientFixture puis table racine crew | false | true | 8 |
| ambientFixture puis table racine vide | false | false | 8 |
| features.plugins=false puis table racine crew | false | true | 6 |
| features.plugins=false puis table racine vide | false | false | 6 |
| features.plugins=false + features.apps=false puis table crew | false | true | 6 |
| features.plugins=false, découverte native puis désactivation par nom hors crew | false | true | 0 |
| Même mécanisme avec tous les noms désactivés (sans bridge) | false | false | 0 |

Le remplacement de la table racine **efface bien les overrides CLI précédents**, mais **ne retire pas les serveurs des couches natives inférieures ni les serveurs synthétisés après fusion**. Il ne satisfait donc pas seul le périmètre crew. Ce résultat prime toute hypothèse générale sur le remplacement de tables TOML.

La désactivation individuelle ambientFixture.enabled=false fonctionne. Appliquer aveuglément le même chemin à tous les noms retournés, sans désactiver les outils de plugins d'abord, échoue avec une erreur native de transport invalide. Aucun contournement ni construction d'entrée invalide n'est retenu.

## Origines et mécanisme supporté

Les objets mcp list de cette version ont les clés auth_status, disabled_reason, enabled, name, startup_timeout_sec, tool_timeout_sec et transport. Aucun champ source/origin/plugin n'est exposé. Les objets transport distinguent les types de transport, sans fournir directement la clé de politique de plugin. Les valeurs de transport n'ont pas été imprimées.

features list annonce **plugins stable true** et **apps stable true**. L'aide CLI documente les overrides -c et les options --enable/--disable par feature. features.plugins=false est donc une capacité officielle disponible de cette version ; son effet observé retire deux serveurs actifs supplémentaires. Ajouter apps=false ne retire rien de plus dans cette configuration et n'est pas nécessaire au mécanisme minimal trouvé. Aucune instruction d'ignorer les règles ou de contourner les approbations n'est ajoutée.

Les [MCP fournis par plugins](https://developers.openai.com/codex/mcp#plugin-provided-mcp-servers) ont un contrôle distinct de leurs transports ; les clés MCP ordinaires et enabled sont décrites dans la [référence de configuration](https://learn.chatgpt.com/docs/config-file/config-reference). Les [priorités natives](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence) continuent à gérer modèle, instructions et permissions. Les outils et instructions packagés dans les plugins ne font pas partie des capacités chargées quand cette feature est désactivée ; cela doit être une restriction explicite du run.

## Proposition minimale avant code

1. Retirer --ignore-user-config du comportement produit. Conserver les overrides explicites du run déjà autorisés (modèle non nul, sandbox et approval), sans modifier les autres préférences natives.
2. Pour cette exécution, ajouter features.plugins=false, afin de ne pas synthétiser les outils de plugins ambiants. Ce réglage est local au processus, pas global.
3. Dans le même cwd et avec ce même override, effectuer un préflight mcp list --json borné. Ne conserver dans le code que les noms/états nécessaires ; ne pas journaliser l'inventaire brut.
4. Passer mcp_servers.<nom>.enabled=false pour les serveurs ordinaires hors crew. Sans bridge, les désactiver tous. Ajouter uniquement le bridge crew de la mission. Refuser un conflit crew existant lorsque le bridge est fourni, pour éviter d'hériter de champs de transport/environnement du même nom.
5. Refuser explicitement une sortie d'inventaire invalide, une erreur native ou un identifiant non représentable de manière sûre par les clés d'override ; ne jamais revenir silencieusement à un run avec des outils ambiants.

Ce mécanisme est observé fonctionnel sur la configuration native actuelle et ne demande ni nouveau champ du contrat ni parseur/copie du config utilisateur. L'interface start/resume étant synchrone, le préflight peut être une invocation synchrone courte et bornée avant le lancement ; toute évolution asynchrone serait une discussion séparée, pas une nouvelle abstraction justifiée ici.

Les preuves natives sont mcp-config-root-probe.json (configuration totale), mcp-config-plugins-probe.json et mcp-config-scoped-probe.json (actifs). Le test JSON natif final vérifie réellement enabled=false pour chaque serveur non autorisé, avec seulement crew actif ou aucun serveur actif.

## Validation à prévoir après accord

Adapter les fixtures hors ligne et les tests d'arguments : absence d'ignore-user-config, plugins désactivés localement, noms MCP hors scope désactivés, modèle nul laissé à la CLI, bridge env absent des argv, collision crew et inventaire invalide refusés. Ajouter une preuve native avec les arguments finaux de l'adaptateur sur mcp list sans LLM. La vérification modèle/MCP/permissions par tour réel attendra le créneau explicite du coordinateur.

Aucun code modifié durant ce diagnostic et aucun nouveau tour live. Les preuves initiales d'exécution isolée restent conservées ; elles ne seront pas présentées comme celles du mode natif corrigé.
