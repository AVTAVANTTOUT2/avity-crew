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
Le mode documentation n'initialise pas Git. Préparer une éventuelle
`.avity-crew.json` **avant** `init` : voir la [configuration](docs/INSTALLATION.md#configuration-avant-le-premier-lancement).
Une livraison de code acceptée reste sur une référence dédiée ; elle n'avance pas
automatiquement votre dossier principal et n'est pas poussée sur un serveur.

- [Installer, configurer, sauvegarder](docs/INSTALLATION.md)
- [Utiliser la conversation, les commandes et la reprise](docs/USAGE.md)
- [Référence CLI](docs/CLI.md), [contexte](docs/CONTEXT.md), [workspaces](docs/WORKSPACE.md)
- [Adaptateur Claude](docs/providers/claude.md), [adaptateur Codex](docs/providers/codex.md)
- [Changelog](CHANGELOG.md)

## Validation réelle

Commandes documentées depuis les sources `4c003ca` ; état de recette communiqué
par le coordinateur le 24 octobre 2026, sans acceptation globale.

| Périmètre                                                    | Preuve disponible                                                                                                         | Limite                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Socle, stockage, contexte, adaptateurs, workspaces (L00–L06) | Livraisons acceptées et essais natifs d'adaptateurs distincts                                                             | Ne prouvent pas une orchestration complète                                                                     |
| Domaine, HTTP/SQLite, CLI et processus locaux                | Suites locales annoncées à 125 puis 143 tests réussis ; scénarios avec fournisseurs simulés identifiés                    | Pas une preuve LLM de bout en bout                                                                             |
| Boucle native intégrée                                       | Claude a réellement appelé `create_task`, `report_blocker` et `publish_note`, et écrit un document sans Git               | Run en pause : la passation exige encore des empreintes avant capture ; contrat en correction, run non accepté |
| Installation locale du tarball                               | `npm pack`, installation dans un préfixe isolé et help/init/status/arrêt depuis deux projets, dont un chemin avec espaces | macOS, Node 26.12.0, aucun objectif ni modèle lancé                                                            |
| L07–L12, équipe mixte et charge jusqu'à sept                 | Pas encore acceptés dans cet état de référence                                                                            | Rapport final et paquet qualifié encore attendus                                                               |
| Plateformes et CI                                            | Vérifications locales macOS seulement à ce stade                                                                          | Linux, Windows et CI distante non qualifiés par cette documentation                                            |

Le premier essai intégré a aussi révélé `IDEMPOTENCY_CONFLICT` sur les événements
multiples. Les progrès natifs ci-dessus restent des preuves partielles : le
modèle a refusé d'inventer les empreintes exigées par l'ancienne entrée de
passation ; leur capture autoritaire côté service est en correction.

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
