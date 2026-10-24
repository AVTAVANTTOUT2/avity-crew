# Avity Crew

Application locale de terminal pour coordonner Claude Code et Codex sur un projet.
Vous fournissez un objectif et des critères observables ; un chef configurable
organise les missions, les contextes, les revues et les preuves conservées localement.

**0.1.0 est en recette.** La CLI, le service et les adaptateurs sont implémentés ;
la validation complète d'une équipe native reste ouverte. Les tests simulés et les
essais séparés des adaptateurs ne valent pas acceptation du produit complet.

Prérequis : **Node ≥ 24.15**, référence **24.22.1** dans `.nvmrc`, npm 11 et Git
pour les missions de code. Claude Code et Codex doivent être installés et connectés
avec leurs comptes natifs. Avity Crew ne demande pas de clé API et ne modifie pas
leur connexion. Versions qualifiées séparément : Claude Code **2.1.304**, Codex
CLI **0.163.0** sur macOS ; les autres versions restent à vérifier.

## Installation et premier objectif

Installer le tarball local préparé depuis ce dépôt :

```sh
npm install --global --prefix "$HOME/.local" "/chemin/avity-crew-0.1.0.tgz"
export PATH="$HOME/.local/bin:$PATH"
avity-crew --help
cd "/chemin/mon projet"
avity-crew init
avity-crew run "Rédiger un guide de démarrage" \
  --criterion "Le guide décrit les prérequis et une procédure vérifiable" \
  --constraint "Ne rien publier à l'extérieur" \
  --chief codex --max-agents 2 --mode documentation
```

`init` prépare le service sans lancer de modèle ; `run` utilise réellement les
CLI et les ressources de vos comptes. En terminal interactif, la commande rejoint
la conversation du run créé. `q` ou Ctrl+C détachent la vue ; le service continue.
Sans terminal, utiliser `status --json` ou `watch` pour suivre le résultat.

Pour du code neuf, `--mode code --init-git` autorise explicitement une base Git.
Le mode documentation n'initialise pas Git. Une éventuelle `.avity-crew.json`
est relue au démarrage du service : voir la [configuration](docs/INSTALLATION.md#configuration-avant-le-premier-lancement).
Une livraison de code acceptée reste sur une référence dédiée ; elle n'avance pas
automatiquement votre dossier principal et n'est pas poussée sur un serveur.

- [Installer, configurer, sauvegarder](docs/INSTALLATION.md)
- [Utiliser la conversation, les commandes et la reprise](docs/USAGE.md)
- [Référence CLI](docs/CLI.md), [contexte](docs/CONTEXT.md), [workspaces](docs/WORKSPACE.md)
- [Adaptateur Claude](docs/providers/claude.md), [adaptateur Codex](docs/providers/codex.md)
- [Développer un adaptateur](docs/ADAPTERS.md), [exemple de mission documentaire](docs/examples/documentation-run.md)
- [Changelog](CHANGELOG.md)

## Validation réelle

La version reste en recette. Le rapport final devra identifier la source exacte,
les versions natives, les parcours exécutés et le paquet installé. Ces guides
décrivent le comportement implémenté ; ils ne prononcent pas l'acceptation de L11/L12.

| Périmètre                             | Preuve et portée                                                                                                              | Limite                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Socle et adaptateurs                  | Livraisons L00–L06 acceptées, avec essais natifs distincts Claude/Codex                                                       | Une recette d'adaptateur ne prouve pas toute l'orchestration              |
| Domaine, transport, CLI et reprise    | Tests locaux avec SQLite, HTTP, Git et processus POSIX ; fournisseurs simulés identifiés                                      | Une simulation ne démontre pas le comportement d'un modèle natif          |
| Charge de sept places                 | Banc simulé : chef actif, six workers actifs, septième worker en file puis lancé après libération d'une place ; arrêt observé | Zéro CLI LLM dans ce banc ; aucune acceptation métier forcée              |
| Recette native et distribution finale | À consigner dans le futur rapport de recette sur le candidat retenu                                                           | Ne pas réutiliser une preuve ancienne comme qualification du paquet final |
| Plateformes                           | Preuves locales macOS                                                                                                         | Linux, Windows et CI distante restent à qualifier séparément              |

Le service capture désormais les documents demandés par chemin et calcule leurs
empreintes. Une correction de plan par `amend_task` est auditée et invalide les
anciennes autorités de la tâche. La clôture exige les livraisons et preuves de
contrôle applicables à la révision actuelle ; ni une sortie native réussie ni un
texte « terminé » ne remplacent cette vérification.

## Développement

```sh
npm ci
npm run check
npm pack
```

Le paquet racine regroupe les modules compilés. Les workspaces privés exportent
leurs sources pour le développement ; les imports relatifs préservent la
topologie lors du build. `npm run build` génère les contrats puis compile l'ESM ;
ne pas éditer `packages/contracts/src/generated`. `npm pack` prépare un fichier
local, sans publication externe.
