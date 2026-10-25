# Installation et configuration

Avity Crew 0.1.0 a été qualifiée localement sur macOS arm64 : consulter la
[validation réelle](../README.md#validation-réelle) et le
[rapport de recette](https://github.com/AVTAVANTTOUT2/avity-crew/blob/146277aa82840de3b66d5e3e16c45bacde39df66/avity-crew-workpack/validation/RELEASE_REPORT.md)
pour les versions, scénarios et limites vérifiés.

## Prérequis

- Node **24.15 minimum**, **24.22.1** comme version de référence ; npm 11
  (le dépôt indique npm 11.20.0).
- Git pour le mode code et les workspaces ; le mode documentation fonctionne
  dans un dossier sans Git.
- Claude Code et/ou Codex installés dans le `PATH` du service et connectés avec
  leur authentification native. Le chef choisi et les workers délégués doivent
  disposer d'un compte et d'un modèle accessibles.

Versions de CLI qualifiées séparément sur macOS : **Claude Code 2.1.304** et
**Codex CLI 0.163.0**. Une version différente n'est pas automatiquement qualifiée.
Voir les notes des adaptateurs [Claude](providers/claude.md) et [Codex](providers/codex.md).
Avity Crew n'installe pas ces CLI, ne copie pas leurs identifiants et ne demande
pas de clé API. Les limites et l'usage restent ceux des comptes natifs.

Les contrôles de processus utilisent actuellement POSIX. macOS est l'hôte des
preuves locales ; Linux reste à qualifier et Windows n'a pas de garantie
d'arrêt d'arbre équivalente. Le test terminal PTY utilise Python sur POSIX ;
Python n'est pas requis pour utiliser le produit installé.

## Préparer puis installer le tarball local

Depuis les sources :

```sh
cd "/chemin/des sources Avity Crew"
npm ci
npm run check
npm pack
```

`npm pack` reconstruit les modules via `prepack`, puis crée
`avity-crew-0.1.0.tgz`. Installer le fichier ainsi produit, pas le nom d'un
paquet supposé publié sur le registre :

```sh
npm install --global --prefix "$HOME/.local" "/chemin/avity-crew-0.1.0.tgz"
export PATH="$HOME/.local/bin:$PATH"
avity-crew --version
avity-crew --help
```

Le préfixe évite de modifier une installation système ; conserver ce `PATH` dans
la configuration de votre shell si nécessaire. Le paquet utilise ses modules
compilés ; son dossier d'installation n'est jamais le projet à traiter.
L'installation peut télécharger les dépendances npm du paquet. Elle ne lance
aucun modèle et ne publie rien.

Vérifier depuis deux projets distincts, dont un chemin avec espaces :

```sh
cd "/chemin/projet-un"
avity-crew --help
avity-crew init --json
avity-crew status --json

cd "/chemin/projet avec espaces"
avity-crew init --json
avity-crew service status --json
```

Remplacer les chemins par des dossiers existants. `init` démarre un service local
et crée ses métadonnées, sans objectif ni modèle. Chaque réponse indique le
projet reconnu. `--project "/autre/projet"` choisit explicitement le dossier.
Deux worktrees d'un même dépôt partagent l'identité du projet et son service ;
ils ne constituent pas deux projets indépendants.

## Configuration avant le premier lancement

Sans fichier, les valeurs par défaut choisissent Codex comme chef, des workers
Claude/Codex, sept places chef compris, 24 000 tokens de budget d'entrée estimé et
le profil de permissions `workspace`. Une capacité configurée n'est pas la preuve
que cette charge a été mesurée ou que les comptes l'autorisent.

Pour personnaliser le projet, créer **avant `init`, `doctor` ou tout premier
lancement du service** un fichier `.avity-crew.json` complet à sa racine.
Il doit respecter le [schéma de configuration](../packages/contracts/schema/project-config.schema.json) :
les objets partiels ne sont pas fusionnés avec des valeurs par défaut.
Exemple pour un projet Node disposant de `npm test` :

```json
{
  "schema_version": 1,
  "orchestrator": { "provider": "codex", "model": null },
  "workers": [
    { "provider": "claude", "model": null },
    { "provider": "codex", "model": null }
  ],
  "max_active_agents": 3,
  "language": "fr",
  "context": {
    "input_budget_tokens": 24000,
    "exclude_paths": [
      ".env",
      ".env.*",
      "*.pem",
      "*.key",
      "node_modules",
      ".git"
    ]
  },
  "verification_commands": [
    {
      "id": "check:tests",
      "argv": ["npm", "test"],
      "cwd": ".",
      "timeout_seconds": 120
    }
  ],
  "delivery": { "mode": "local", "target_ref": null },
  "permissions": {
    "profile": "workspace",
    "allow_production": false,
    "allow_external_publication": false
  }
}
```

Adapter les commandes de vérification au projet ; ce sont de vraies commandes
locales exécutées sur le candidat, avec `cwd: "."` pour l'intégration actuelle.
Un tableau vide n'apporte pas les tests métier manquants. `model: null` laisse
la CLI résoudre son modèle natif. `--chief`, `--model` et `--max-agents` permettent
des choix pour un run, dans la capacité du service ; ils ne réécrivent pas les
préférences du projet.

Le service relit ce fichier **à chaque démarrage**, à la racine du projet reconnu
(y compris depuis un sous-dossier Git). Il valide puis remplace la configuration
persistée complète, sans réinitialiser l'identité du projet, ses runs ou son
historique. Il refuse un fichier invalide, symbolique ou de plus de 256 Kio.
Si le fichier est absent, la configuration déjà persistée est conservée ; un
projet neuf utilise les valeurs par défaut. Supprimer le fichier ne rétablit donc
pas automatiquement ces valeurs.

Une modification pendant que le service tourne n'est pas rechargée à chaud.
Pour l'appliquer, mettre en pause les travaux concernés, attendre leurs arrêts,
modifier le fichier complet, puis exécuter depuis ce projet :

```sh
avity-crew service stop
avity-crew service start
avity-crew status --json
```

Inspecter `data.project.config` dans le statut. Les choix déjà enregistrés dans un
run (chef, modèle, limite propre au run) ne sont pas réécrits par ce rechargement ;
la capacité du scheduler vient de la configuration du service redémarré. Ne pas
supprimer la base pour changer des préférences.

`workspace` demande les permissions natives d'édition de workspace ; `read_only`
demande la lecture seule. Le profil `custom` existe dans le schéma mais est
actuellement traité comme `workspace`, sans permissions fines personnalisées.
Les outils MCP restent limités par rôle/run/tentative et peuvent enregistrer des
actions de coordination même en lecture seule. Le contrôle de scope à la capture
de livraison ne remplace pas une isolation OS. Aucun bypass global, push,
déploiement ou accès de production n'est activé par ces exemples.

## Données, sauvegarde et restauration

Le service stocke chaque projet dans
`$XDG_DATA_HOME/avity-crew/project-…`, ou
`~/.local/share/avity-crew/project-…` si `XDG_DATA_HOME` n'est pas défini.
Le chemin exact figure dans `status --json`, sous `data.project.data_dir`.
Choisir `XDG_DATA_HOME` avant le premier lancement et garder la même valeur pour
retrouver le projet. Les chemins réels et le répertoire Git commun déterminent
son identité ; déplacer un dossier sans Git change cette identité.

Ce dossier privé contient la base `state.sqlite`, les artefacts, les workspaces,
les métadonnées d'endpoint, les accès locaux et `service.log`. Ne pas le versionner
ni afficher les fichiers de clés/capabilities. Un export est un rapport ; il ne
remplace ni la base, ni Git, ni les fichiers de travail.

Pour une sauvegarde manuelle cohérente :

1. Consulter les runs et sauvegarder les exports utiles. Mettre en pause les runs
   concernés, arrêter le service avec `avity-crew service stop`, puis constater
   la fin effective des processus avant de copier.
2. Copier l'intégralité du dossier de données dans une destination privée neuve
   et conserver aussi le dépôt principal, son `.git` et tous les worktrees avec
   leurs modifications non commises. Une simple copie de `state.sqlite` pendant
   les écritures n'est pas une sauvegarde complète.
3. Conserver éventuellement un bundle Git supplémentaire :
   `git bundle create "/sauvegarde/privee/projet.bundle" --all`.
   Il conserve les références/commits, **pas** les fichiers non commis des worktrees.

La CLI ne fournit pas de commande `backup`. L'API de stockage dispose d'une
[sauvegarde SQLite cohérente](STORAGE.md), qui n'embarque pas les workspaces ni les
conversations natives. Ces dernières restent gérées par chaque CLI fournisseur.

Restaurer avec le service arrêté, idéalement à la même version et aux chemins
d'origine, après avoir conservé une copie de l'état actuel. Base, artefacts et
Git doivent correspondre ; des chemins déplacés peuvent exiger une réparation
des worktrees. Les métadonnées restaurées ne prouvent pas qu'un ancien processus
est arrêté. Ne pas effacer un verrou, une opération ou une clé pour forcer la
reprise : suivre le [diagnostic de reprise](USAGE.md#reprendre-après-une-interruption).

## Mise à jour et désinstallation locale

Avant une mise à jour, sauvegarder comme ci-dessus et arrêter les services de
chaque projet utilisant cette installation. Installer le nouveau tarball dans
le même préfixe, vérifier `avity-crew --version`, puis redémarrer un projet et
inspecter son statut avant toute reprise explicite. Conserver l'ancien tarball et
la sauvegarde ; revenir à un ancien exécutable ne garantit pas la compatibilité
d'une base déjà migrée. Ne pas remplacer la base active par une copie ancienne.

Pour retirer uniquement l'exécutable installé dans le préfixe de cet exemple,
après arrêt des services :

```sh
npm uninstall --global --prefix "$HOME/.local" avity-crew
```

Cette commande ne supprime ni les projets ni leurs données privées. Les conserver
permet une réinstallation ; leur effacement éventuel est une action distincte,
à décider après vérification des sauvegardes et de l'arrêt des processus.

## Contrôle du paquet avant distribution

`npm pack --dry-run --json` reconstruit le projet et décrit le contenu prévu sans
créer de tarball. Vérifier la présence de `bin/avity-crew.mjs`, des modules ESM
compilés (dont le service et le pont MCP), des schémas et des guides. Les templates
de contexte et migrations sont intégrés aux modules compilés ; ils ne sont pas
chargés depuis le workpack de construction.

Vérifier aussi l'absence de données privées : configuration locale, clés,
conversations, bases et worktrees de recette. Une liste de fichiers correcte ne
remplace pas l'installation du tarball final dans un préfixe neuf, puis les
commandes depuis plusieurs projets et la recette native sur cette même source.
Consigner version, empreinte du tarball et résultats pour chaque nouvelle
distribution. Le rapport historique de 0.1.0 ne qualifie pas les paquets futurs.
