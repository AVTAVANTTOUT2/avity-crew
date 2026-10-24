# Adaptateur Codex

La V1 utilise la CLI officielle avec `codex exec --json`. Cette voie non interactive suffit pour un tour, ses événements, les outils MCP et une reprise ciblée. App Server est indiqué expérimental par l'aide installée et n'est pas nécessaire à ce contrat.

## Version et découverte

Version de référence : **Codex CLI 0.163.0**, vérifiée le 24 octobre 2026 sur macOS. `CodexProvider.probe()` cherche le binaire dans `PATH` (ou utilise le chemin fourni au constructeur), puis exécute `--version`, `exec --help` et `exec resume --help`, avec délai et taille de sortie bornés. Un exécutable absent ou inutilisable produit `PROVIDER_UNAVAILABLE`.

Le modèle est celui de `ProviderRequest.model` lorsqu'il est renseigné. Sinon Codex résout le modèle avec ses préférences natives chargées ; l'adaptateur n'invente pas un nom de modèle à partir d'événements qui ne l'exposent pas. L'accessibilité effective du modèle est vérifiée par Codex à l'exécution.

## Démarrage et reprise

Les arguments sont un tableau passé directement au processus, sans shell. Le prompt entier va sur stdin avec le marqueur `-`. Les options communes sont `--json --skip-git-repo-check`, ainsi que les overrides `sandbox_mode` et `approval_policy` provenant de la politique du run. Les seuls sandboxes autorisés par le contrat sont `read-only` et `workspace-write`.

Le produit charge la configuration native : modèle, instructions et protections configurées restent disponibles, sous les overrides explicitement autorisés du run. Il ne passe ni `--ignore-user-config` ni `--ignore-rules`, ne redéfinit pas `CODEX_HOME` et ne copie aucun fichier d'authentification. Les premières preuves de recette utilisaient une configuration isolée ; elles sont conservées comme telles, sans les présenter comme celles du comportement produit corrigé.

Les capacités MCP sont limitées à la mission. `features.plugins=false`, limité au processus, empêche les outils de plugins ambiants d'être synthétisés ; leurs outils et instructions packagées ne sont donc pas chargés. Les instructions natives hors plugins et les protections d'exécution restent gérées par Codex. Aucune approbation automatique globale n'est ajoutée.

Avant chaque démarrage **et chaque reprise**, un préflight natif `codex -c features.plugins=false mcp list --json` s'exécute dans le cwd demandé. Il ne lance ni modèle ni serveur et n'est jamais réutilisé depuis un cache. L'appel synchrone est borné à **10 secondes et 1 MiB** ; il peut ajouter jusqu'à 10 secondes au lancement, avant la création du processus de tour. Seuls les noms et états nécessaires sont traités ; stdout/stderr bruts de configuration ne sont jamais repris dans une exception.

Chaque serveur MCP ordinaire découvert est désactivé par `mcp_servers.<nom>.enabled=false`, puis seul le bridge `crew` de la mission est ajouté. Sans bridge, tous les serveurs découverts sont désactivés. Un nom natif `crew` déjà configuré avec bridge demandé, un nom non représentable sûrement, un inventaire illisible ou une erreur native provoquent un refus explicite avant le tour. Les identifiants acceptés sont actuellement lettres ASCII, chiffres, `_` et `-` ; aucun repli ne réactive des outils ambiants. Cette restriction repose sur la configuration native observée au préflight ; la configuration personnelle ne doit pas être modifiée pendant le lancement d'un run.

`resume()` utilise `exec resume <UUID> -` avec le nouveau contexte sur stdin. Le même override `sandbox_mode` est transmis par `-c` : la sous-commande de reprise 0.163.0 n'accepte pas l'option `--sandbox`. Une chaîne vide, un nom ambigu ou `--last` sont rejetés avant le lancement. Une même session doit conserver un seul propriétaire ; l'adaptateur ne décide pas de l'ordonnancement des reprises.

## Capacités

| Capacité                 | Voie V1                                       | Limite                                                                               |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Lancement                | `exec --json`, cwd et stdin explicites        | La réussite du tour ne vaut pas acceptation du livrable                              |
| Reprise native           | UUID explicite, nouveau prompt                | Aucun repli vers la dernière session                                                 |
| Événements               | Session, texte, outils, résultat, erreurs     | Les événements inconnus restent des diagnostics identifiables                        |
| Interruption / arrêt     | Runner commun, groupe de processus            | Un arrêt demandé interdit un résultat réussi                                         |
| Messages pendant le tour | `UNSUPPORTED`                                 | Le superviseur conserve le message et reprend après la fin ou l'interruption         |
| Réponse aux permissions  | `unsupported`                                 | Pas de saisie de terminal émulée ; remonter le refus et faire décider le superviseur |
| MCP stdio                | Serveur `crew` par configuration du processus | Seuls les outils du bridge fourni sont ajoutés par l'adaptateur                      |
| Usage                    | Tokens d'entrée et sortie natifs              | Coût monétaire et métriques absentes restent indisponibles                           |

La découverte de lancement et reprise s'appuie sur l'aide locale. MCP et usage sont annoncés vérifiés uniquement pour la version de référence ; une autre version reçoit `unverified` pour ces capacités jusqu'à qualification.

## Événements et erreurs

`thread.started` donne immédiatement `native_session_id`. Le texte final provient des `agent_message` terminés, sans doubler le résultat de tour. Commandes (identifiant, état, code de sortie, sortie), changements de fichiers, appels MCP, recherches et plans deviennent des événements `tool` lisibles. Les tokens de `turn.completed` deviennent `usage`, puis un résultat natif réussi. Les champs non disponibles ne sont pas fabriqués.

`turn.failed`, `error` et les erreurs d'items deviennent des erreurs classées : quota, authentification, réseau, permission ou protocole. Un refus terminal de commande ou un refus d'approbation d'un outil MCP est explicite et interdit un résultat réussi, même si Codex termine son tour avec un code 0. Un code non nul d'une commande récupérable reste un événement outil : Codex peut le corriger dans le même tour. Le runner garde stderr séparé, borne JSONL et les diagnostics, masque les valeurs sensibles du bridge, et exige résultat natif réussi **et** sortie processus 0, sans erreur ni interruption.

Exception étroite vérifiée en 0.163.0 : les avertissements de démarrage « Codex is ignoring … unrecognized configuration settings. » et « Under-development features enabled: » arrivent dans stdout comme `item.completed` avec un item `error`, sans champ de sévérité. Ces deux préfixes deviennent des diagnostics `unknown` visibles, avec leur message conservé. Les autres items d'erreur, `error` de premier niveau et `turn.failed` restent fatals. Un avertissement ne crée aucun résultat réussi : `turn.completed` et sortie 0 sont toujours requis ; une sortie non nulle ou un résultat absent échoue. La configuration utilisateur n'est ni modifiée ni rendue silencieuse.

Le consommateur doit lire `events` pendant qu'il attend `result`. Le runner applique une contre-pression bornée ; attendre le résultat sans consommer les événements peut suspendre volontairement un gros flux.

## Bridge MCP

`request.bridge` fournit commande, arguments et environnement. L'adaptateur transmet `mcp_servers.crew.command`, `.args`, `.required=true` et `.env_vars` via `-c`. `env_vars` contient uniquement les **noms** des variables. Les valeurs `bridge.env` sont transmises à l'environnement du processus par le runner ; elles ne sont placées ni dans les arguments, ni dans le prompt, ni dans les diagnostics normalisés.

Le superviseur peut fournir `bridge.approved_tools` après son contrôle ACL du transport. Si le champ est absent, le comportement natif L05 reste inchangé. Une liste présente donne uniquement des overrides par outil `-c mcp_servers.crew.tools.<méthode>.approval_mode="approve"` ; une liste vide n'ajoute aucun accord. Les noms proviennent des méthodes canoniques du schéma `ToolCall`. Doublons, noms inconnus, noms préfixés de serveur, wildcards et fragments injectables sont rejetés `INVALID_INPUT` avant le préflight. Aucun `default_tools_approval_mode` global ni changement de `approval_policy` n'est ajouté ; l'accord natif ne dépasse jamais les ACL du bridge, qui restent nécessaires à chaque appel. Les annotations des mutations restent `readOnlyHint: false` et un refus natif reste fatal même pour une méthode listée.

La [documentation officielle MCP](https://developers.openai.com/codex/mcp) expose `tools.<tool>.approval_mode` et illustre la valeur `approve`. Un diagnostic sans modèle sur Codex 0.163.0 a accepté cet override avec `mcp get crew --json` ; la sortie de configuration a été traitée en code sans afficher ses valeurs. Les tests hors ligne contrôlent les arguments et les refus. L'exécution réelle des mutations `create_task`/`publish_note` appartient à la recette L07 ; la recette ping antérieure ne la démontre pas.

La fixture `tests/fixtures/providers/mcp-ping.mjs` est un serveur de recette, distinct du bridge produit L07. `scripts/live-codex.mjs` vérifie son appel réel à `crew.ping` et une modification de fichier dans un dépôt jetable. Il réutilise `codexArguments` pour le contrôle négatif, afin de garder le même préflight et périmètre MCP que le produit. Il conserve un rapport JSON au chemin absolu demandé, sans valeur de capacité du bridge.

Le ping diagnostique déclare honnêtement `readOnlyHint: true`, `destructiveHint: false` et `openWorldHint: false` ; seul son journal de recette est ajouté. Aucun auto-approve global n'est configuré. Lors du premier essai réel, l'absence de ces annotations a entraîné un refus natif d'approbation et aucun appel `tools/call` : cette preuve négative a déclenché une régression du décodeur. Pour L07, les outils de coordination qui modifient un état demanderont une politique native par outil étroite, explicitement autorisée, et les ACL du service.

## Validation

Les tests `tests/providers/codex.test.ts` utilisent un exécutable factice clairement identifié : aucun appel fournisseur. Ils couvrent le décodeur, les arguments/stdin, les environnements sensibles, la fragmentation UTF-8, deux sessions, la reprise exacte avec contexte nouveau, les erreurs, la troncature et l'interruption. Les preuves réelles et leurs identifiants de sessions sont consignés séparément dans le registre canonique `avity-crew-workpack/validation/L05/`.

Après compilation, exécuter uniquement dans un créneau de capacité autorisé :

```sh
node scripts/live-codex.mjs /chemin/absolu/live-single.json single
node scripts/live-codex.mjs /chemin/absolu/live-parallel.json parallel
node scripts/live-codex.mjs /chemin/absolu/live-permission.json permission
```

`single` utilise au plus une CLI à la fois ; `parallel` en utilise deux. `permission` rejoue seulement le refus natif sans répéter les éditions et reprises déjà vérifiées. Ce contrôle exige une tentative d'outil réelle et un refus normalisé ; une explication du modèle seule ne suffit pas. Il configure le seul outil diagnostique `crew.ping` avec `approval_mode="prompt"` via le runner et le décodeur partagés, sous politique `never` inchangée : cette règle plus restrictive ne modifie pas le contrat produit et vérifie qu'aucun appel refusé n'atteint le bridge. `AVITY_CREW_CODEX_BINARY` peut sélectionner un binaire local et `AVITY_CREW_CODEX_MODEL` un modèle accessible. Les fichiers sont vérifiés pendant l'exécution ; le système hôte peut nettoyer ses répertoires temporaires ensuite.

## Sources

- [Mode non interactif officiel](https://developers.openai.com/codex/non-interactive-mode), consulté le 24 octobre 2026 : JSONL, stdin, permissions, reprise et authentification native.
- [Configuration MCP officielle](https://developers.openai.com/codex/mcp), consultée le 24 octobre 2026 : stdio, overrides de configuration et transfert par `env_vars`.
- Aide locale réellement exécutée : `codex --version`, `codex exec --help`, `codex exec resume --help`, `codex app-server --help`.
- Audit initial : `avity-crew-workpack/validation/L00/providers.md`.
