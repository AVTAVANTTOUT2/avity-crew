# Exemple : un guide écrit, relu et capturé

Cet exemple utilise les comptes natifs Claude/Codex. Il consomme leurs ressources
lors de `run` et ne constitue pas une recette déjà exécutée. Utiliser un dossier
de travail jetable et des sources sans secret ; aucun dépôt Git n'est nécessaire.
Pour un simple diagnostic sans modèle, s'arrêter après `init` et `status`.

## Préparer la source et la mission

```sh
mkdir "essai documentation crew"
cd "essai documentation crew"
```

Créer `source.md` avec un contenu suffisant pour ce petit exercice :

```markdown
# Projet Atlas — source d'exercice

Atlas est un outil local de classement de documents destiné à une équipe interne.
L'utilisateur prépare un dossier contenant ses documents puis ouvre ce dossier
dans l'application. L'exercice ne fournit ni commande d'installation réelle ni
service distant. Le guide doit signaler ces inconnues et ne pas les inventer.
Les documents privés ne doivent pas être publiés.
```

Créer `mission.md` :

```markdown
Rédiger docs/accueil.md à partir de source.md uniquement.
Le guide doit préciser le public, la préparation du dossier et les informations
qui restent inconnues. Ne pas inventer une commande d'installation.

Organiser une tâche documenter pour l'écriture et une tâche reviewer distincte
pour contrôler le fichier capturé. Le writer couvre le critère d'écriture ;
la revue indépendante et la clôture ne sont pas des livrables qu'il doit s'attribuer.
Le reviewer doit contrôler le critère de contenu et produire sa propre preuve
de contrôle pour le critère global de revue. Le chef vérifie ces deux critères
sur les livraisons courantes avant toute clôture.

Pour la passation documentaire, fournir document_paths: ["docs/accueil.md"].
Laisser au service la capture et le calcul des empreintes ; ne pas inventer un
hash, une commande exécutée, une revue approuvée ou un résultat de vérification.
En cas de plan inadéquat, demander une décision puis un amend_task audité plutôt
que retirer un critère global ou prétendre qu'il est satisfait.
```

## Lancer et observer

```sh
avity-crew init --json
avity-crew status --json
avity-crew run --prompt-file mission.md \
  --criterion "docs/accueil.md décrit le public, la préparation et les inconnues fidèlement à source.md" \
  --criterion "Une revue indépendante approuvée contrôle le document capturé et est utilisée pour son acceptation" \
  --constraint "Écrire seulement docs/accueil.md, ne rien publier et ne pas inventer de preuve" \
  --chief codex --max-agents 3 --mode documentation
```

Le défaut de configuration autorise les workers Claude et Codex. Si le projet a
une configuration différente, la relire avant le lancement ; la limite du run
ne peut pas dépasser celle du service. En mode documentation, les écritures dans
le dossier partagé sont sérialisées même avec plusieurs places disponibles.

Conserver l'ID réel renvoyé par `run`. Depuis un autre terminal, dans ce dossier :

```sh
avity-crew status --run run:ID --json
avity-crew inspect-context --run run:ID --subject control:run:ID --json
avity-crew export --run run:ID --format markdown > "rapport exercice.md"
```

Remplacer `run:ID` par cet ID complet. L'export est un rapport, pas une sauvegarde.
Vérifier le fichier présent, sa capture, la Review indépendante et les preuves de
contrôle utilisées par l'acceptation. Une sortie CLI à zéro ou la présence du
document seule ne prouve pas les deux critères. Un blocage ou un refus de
permission doit rester visible et peut nécessiter une réponse utilisateur.

Pour suspendre l'exercice sans l'accepter artificiellement :

```sh
avity-crew pause --run run:ID
avity-crew status --run run:ID --json
avity-crew service stop
```

Attendre l'arrêt observé avant de nettoyer le dossier et conserver les données
privées nécessaires à la reprise. Consulter le [guide d'usage](../USAGE.md) et la
[configuration et sauvegarde](../INSTALLATION.md) pour continuer ou désinstaller.
