# L05 — Revue du chargement de configuration Codex

Date : 24 octobre 2026. Auteur : l05-codex, à la demande du coordinateur. Lecture seule du code candidat **git:f1d594a488438dbee12f546f4bdab28a44b42c9b** ; seul ce rapport est écrit. Aucun appel modèle, test live, sous-agent, modification de code, configuration utilisateur ou accès aux fichiers de credentials.

## Conclusion

**Oui : --ignore-user-config retire le modèle préféré, les réglages de permissions et les MCP déclarés dans la couche utilisateur config.toml. L'authentification native est conservée.** Avec model:null, l'adaptateur ne transmet pas --model : la CLI choisit donc le modèle à partir des couches restantes et de ses valeurs par défaut, pas nécessairement le choix habituel du config utilisateur. La portée du flag est confirmée par l'aide installée 0.163.0 et la [référence officielle CLI](https://learn.chatgpt.com/docs/developer-commands#codex-exec).

Le candidat préserve **l'authentification et les mécanismes natifs d'exécution/approbation**, mais il ne préserve pas intégralement **les préférences et protections configurées par l'utilisateur**. Cette distinction doit être explicite avant acceptation. L00 qualifiait effectivement ce flag de choix d'isolation de recette, sans l'imposer au produit ; son emploi inconditionnel dans argumentsFor est un choix ultérieur de L05.

## Vérifications réellement réalisées

- Binaire /Users/zeldris/.local/bin/codex : --version renvoie codex-cli 0.163.0 ; code 0.
- exec --help et exec resume --help : codes 0 ; même portée documentée pour --ignore-user-config, -c et --model. L'option séparée --ignore-rules existe ; L05 ne la passe pas.
- Code immutable lu via git show f1d594a:packages/providers/src/codex.ts : le flag est systématique en démarrage et reprise ; sandbox_mode et approval_policy viennent toujours de ProviderRequest ; --model n'est ajouté que si model !== null ; seuls les champs du serveur MCP crew sont ajoutés par L05.
- Audit validation/L00/providers.md relu sur ce point. Aucune lecture du config.toml personnel pour déterminer ses valeurs réelles.

## Effets et limites

| Élément | Effet du candidat actuel |
| --- | --- |
| Authentification | CODEX_HOME demeure utilisé par la CLI pour sa connexion native ; le flag ne demande ni une autre identité ni une copie du cache. |
| Modèle non nul | --model fournit le choix explicite du run, sous réserve d'accessibilité. |
| Modèle nul | Absence d'override de modèle et absence de couche utilisateur ; ne signifie pas hériter du modèle préféré de cette couche. |
| Préférences d'approbation/sandbox utilisateur | Leurs valeurs dans ce fichier sont exclues. De plus, les deux valeurs explicites du run ont priorité sur des valeurs de configuration chargées. |
| Restrictions plus fines | Les entrées utilisateur telles que sandbox_workspace_write.*, shell_environment_policy.* ou profils permissions.* ne sont pas reconstituées par ProviderRequest, qui contient seulement deux permissions grossières. Les retirer peut perdre une restriction autant qu'un droit supplémentaire. |
| MCP utilisateur | Les déclarations et politiques d'outils de cette couche sont retirées ; crew est ajouté pour le processus. Cela réduit les outils ambiants issus de cette couche, sans démontrer leur absence dans toutes les autres couches. |
| Règles execpolicy | Le flag ne demande pas --ignore-rules. Leur chargement réel reste également dépendant de la confiance du projet et des couches concernées ; aucun test d'héritage n'a été exécuté ici. |

Les clés de sandbox, filtrage d'environnement, MCP et profils sont décrites dans la [référence de configuration](https://learn.chatgpt.com/docs/config-file/config-reference). La documentation des [permissions](https://learn.chatgpt.com/docs/permissions#define-and-select-a-profile) montre notamment des profils avec chemins, réseaux et refus ciblés : deux enums dans ProviderRequest ne représentent pas tout ce contrat. Il s'agit d'une analyse des capacités déclarées, pas d'une lecture des restrictions actuellement configurées sur cette machine ni d'une qualification dynamique de toutes ces clés en 0.163.0.

Les overrides CLI ont la priorité sur les valeurs de configuration. Les couches projet approuvé, profil sélectionné, utilisateur, paramètres cloud/système et valeurs intégrées sont distinctes ; les exigences administrateur requirements.toml contraignent les choix et ne sont pas de simples valeurs par défaut. La suppression de la seule couche utilisateur ne désactive donc pas, à elle seule, ces exigences. Elle peut aussi retirer les décisions de confiance de projet qui étaient stockées dans cette couche. Voir la [priorité de configuration officielle](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence).

**Ne pas présenter ce flag comme un sandbox supplémentaire ou comme une isolation totale.** Son nom et l'aide désignent un seul fichier. Cette revue ne conclut pas à la suppression d'AGENTS.md, des instructions, des hooks ou plugins définis hors de ce fichier. L'auth et les sessions natives restent communes à la CLI.

## Rationale L05 et compromis

Le choix visait à empêcher le démarrage automatique des MCP utilisateur ambiants dans les workspaces d'agents, à ne transmettre que le bridge de mission fourni et à rendre les recettes reproductibles. Il évite aussi d'hériter par inadvertance de réglages utilisateur plus permissifs. Ce bénéfice est réel pour la couche retirée ; il ne prouve pas qu'aucune autre couche n'apporte un outil.

**Compromis symétrique : des restrictions personnelles plus strictes sont retirées également.** Les contrôles natifs continuent à fonctionner avec la politique explicitement fournie et les exigences gérées applicables ; cela n'autorise pas à annoncer que toutes les protections personnelles ont été conservées. Les preuves live L05 qualifient l'exécution isolée actuelle, pas une exécution héritant de la configuration utilisateur.

## Choix minimal recommandé au coordinateur

Pour un produit qui entend conserver les préférences natives, je recommande de **ne pas imposer ce flag par défaut** et de le réserver à la recette isolée explicitement choisie. Laisser la CLI résoudre le modèle lorsque model est nul évite un parseur maison du config utilisateur et toute copie de configuration ou de credentials. Garder les overrides du run uniquement sur les champs dont le superviseur possède réellement la décision : modèle explicite, permissions autorisées et bridge.

**Ne pas appliquer cette recommandation comme une simple suppression de ligne.** Le même changement doit traiter le périmètre des MCP hérités : seuls les serveurs/outils autorisés pour la mission peuvent être actifs, et le nom crew doit être réservé ou une collision doit être refusée. Les serveurs MCP disposent de enabled, enabled_tools, disabled_tools et de politiques par outil ; ces commandes ne constituent pas une ACL du service à elles seules. Voir [MCP officiel](https://developers.openai.com/codex/mcp#other-configuration-options). Il faudrait une découverte native filtrée aux noms/capacités, sans journaliser valeurs, URLs sensibles ou environnement, puis des overrides restrictifs pour les serveurs non autorisés. Ce travail n'est pas inclus dans la présente lecture seule.

Je ne recommande ni de recopier config.toml dans un dossier isolé, ni de réimplémenter sa fusion, ni de prétendre qu'un override vide de table efface les couches précédentes sans preuve. La simple conservation de cwd et du bridge crew ne borne pas les autres outils ambiants. Les détails de fusion, de profils et de conflit crew doivent être qualifiés hors ligne avant ce changement.

Si la V1 garde le comportement actuel pour maintenir un périmètre MCP volontairement réduit, cela reste un **choix produit d'exécution isolée** à faire accepter explicitement : model:null signifie défaut de cette exécution isolée ; les réglages utilisateur ne sont pas hérités ; les restrictions nécessaires doivent provenir d'une politique de run autorisée et des exigences natives applicables. Ce n'est pas une preuve de conservation de la configuration personnelle. Aucun nouveau champ partagé n'est proposé ni ajouté ici.

## Portée de preuve et suite

Aucun correctif appliqué : source f1d594a stable. Aucun appel fournisseur ni nouvelle recette. Les commandes d'aide sont réellement exécutées ; les conclusions de portée reposent sur l'aide installée et les pages officielles effectivement ouvertes. L'effet exact sur la configuration personnelle est volontairement inconnu puisqu'elle n'a pas été consultée.

Décision attendue de la revue : accepter explicitement la sémantique isolée documentée, ou demander un correctif atomique « héritage natif + périmètre MCP autorisé » avant de revendiquer l'héritage des préférences. Les preuves live existantes ne doivent pas être transposées à un mode natif non exécuté.
