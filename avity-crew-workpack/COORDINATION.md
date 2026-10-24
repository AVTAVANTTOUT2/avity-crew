# Travailler à plusieurs pour construire Avity Crew

Ce protocole organise **les agents qui construisent le logiciel**. L'utilitaire
`scripts/coordination.py` est utilisable dès maintenant et ne dépend pas du futur
service Avity Crew. Les contrats du produit sont décrits séparément dans `docs/`.

## 1. Choisir un registre commun

Tous les agents lisent d'abord `agent.md`, les consignes applicables du dépôt,
leur lot et l'état courant. Le coordinateur désigne **une seule copie canonique**
de ce dossier. Chaque agent utilise son chemin absolu, y compris lorsqu'il
développe dans un autre worktree Git.

```bash
CREW_WORKPACK="/chemin/absolu/avity-crew-workpack"
python3 "$CREW_WORKPACK/scripts/coordination.py" --root "$CREW_WORKPACK" status
```

`--root` désigne le dossier contenant `coordination/lots.json`, et non le dossier
du code à modifier. Sa valeur par défaut est le parent de `scripts/` résolu
depuis le chemin du script. Utiliser explicitement le même `--root` rend le
choix visible. Ne pas lancer les agents chacun sur une copie indépendante du
registre : leurs réservations ne pourraient pas se voir.

Prérequis du helper : Python 3.9 ou supérieur, macOS, Linux ou WSL, système de
fichiers local prenant en charge `flock` et le remplacement atomique de fichiers.
Windows natif et les copies synchronisées par plusieurs machines ne constituent
pas un registre commun pris en charge par ce helper.

## 2. Prendre un lot disponible

Les lots et leurs dépendances sont définis dans `coordination/lots.json`.
Un lot ne peut être pris que si ses dépendances sont `accepted`.

```bash
python3 "$CREW_WORKPACK/scripts/coordination.py" --root "$CREW_WORKPACK" claim L00 --agent claude-audit-01
```

La réponse JSON fournit `owner`, `attempt` et `token`. Le jeton protège la
tentative contre les retours tardifs d'un ancien exécutant ; ce n'est pas un
identifiant d'authentification au fournisseur.

```bash
CREW_TOKEN="COLLER_LE_JETON_RETOURNE"
python3 "$CREW_WORKPACK/scripts/coordination.py" --root "$CREW_WORKPACK" heartbeat L00 --agent claude-audit-01 --token "$CREW_TOKEN"
```

Un `claim` réussi réserve le lot. Il ne lance aucun agent et ne modifie aucun
fichier applicatif. L'agent travaille ensuite dans le périmètre du lot, avec les
branches et worktrees convenus avec le coordinateur. Pour découper un lot en
sous-tâches internes, le propriétaire conserve la responsabilité du lot ; il
documente la répartition et les autres agents évitent de le réclamer.

`heartbeat` confirme régulièrement que l'exécutant est encore présent. Le seuil
d'alerte est de 120 minutes par défaut, ajustable au `claim` avec
`--lease-minutes`. Son dépassement affiche `heartbeat_overdue: true` ; **il ne
libère jamais la réservation automatiquement**.

## 3. Publier les informations utiles

Les notes sont ciblées sur un lot et peuvent être publiées par un autre agent
que son propriétaire. Chaque note possède un identifiant unique et un auteur.

```bash
python3 "$CREW_WORKPACK/scripts/coordination.py" --root "$CREW_WORKPACK" note L00 --agent claude-audit-01 --kind finding --message "Le dépôt utilise déjà une commande de validation ; référence et résultat à joindre au rapport."
python3 "$CREW_WORKPACK/scripts/coordination.py" --root "$CREW_WORKPACK" status L00
```

Types disponibles : `progress`, `finding`, `question`, `proposal`, `decision`.
Une proposition n'est pas une décision retenue. Une décision publiée doit
identifier dans son texte le choix, sa raison, les lots concernés et la personne
ou le rôle qui l'a validée. Les notes concernent les observations, choix et
actions utiles ; ne pas y copier de secrets ni l'ensemble des conversations.

Le statut détaillé affiche les notes, passations, revues et événements du lot.
Le coordinateur lit les informations concernées avant de déléguer la suite.
Un fichier de note simplement créé ailleurs n'est pas automatiquement distribué
aux autres agents : publier sa référence dans le registre.

## 4. Signaler un blocage puis reprendre

```bash
python3 "$CREW_WORKPACK/scripts/coordination.py" --root "$CREW_WORKPACK" block L00 --agent claude-audit-01 --token "$CREW_TOKEN" --reason "Décision métier nécessaire ; question et options documentées dans la note du lot."
python3 "$CREW_WORKPACK/scripts/coordination.py" --root "$CREW_WORKPACK" resume L00 --agent claude-audit-01 --token "$CREW_TOKEN" --reason "La décision a été reçue et inscrite au registre."
```

`block` conserve les changements et le propriétaire. Les autres lots prêts
peuvent continuer. `resume` réactive le même propriétaire et la même tentative ;
il est destiné à un blocage résolu, pas à remplacer une session.

Pour remplacer un exécutant, le coordinateur vérifie d'abord son arrêt et l'état
de son worktree. Il préserve les changements et écrit une raison explicite :

```bash
python3 "$CREW_WORKPACK/scripts/coordination.py" --root "$CREW_WORKPACK" reassign L00 --agent codex-audit-02 --by coordinateur-01 --reason "Ancien processus arrêté, changements conservés et dossier de reprise préparé." --previous-worker-stopped
```

Cette commande produit un nouveau jeton et une nouvelle tentative. Les anciens
jetons ne peuvent plus soumettre, reprendre ni actualiser la mission. Le helper
enregistre l'attestation d'arrêt ; **il ne peut pas vérifier lui-même que le
processus du fournisseur est réellement arrêté**. Un simple silence ou une
alerte de heartbeat ne justifie pas une réattribution.

## 5. Préparer une passation vérifiable

Copier `examples/build-handoff.json` dans un fichier de travail portant le lot,
l'agent et la tentative, puis remplir les champs avec des observations réelles.
Les valeurs `A_REMPLACER` sont volontairement incompatibles avec le validateur.

Le rapport de chantier contient :

| Champ | Règle |
| --- | --- |
| `summary` | Résultat concret obtenu. |
| `revision` | `git:<SHA complet>` ou `sha256:<empreinte de l'artefact documentaire>`. |
| `artifacts` | Commits complets, ou fichiers référencés avec leur SHA-256 réel. |
| `tests` | Vérifications réellement exécutées, commande, code de sortie, preuve et révision. |
| `limitations` | Éléments empêchant de considérer le lot comme complet. |
| `next_steps` | Travail restant dans ce lot. Les missions suivantes déjà prévues appartiennent à leurs propres lots. |
| `live_verification` | `not_applicable`, `unverified` ou `passed`, selon les observations. |

Chaque vérification contient `name`, `command`, `kind`, `exit_code`,
`evidence_ref`, `revision`. Les types sont `unit`, `integration`, `e2e`, `live`,
`doc_validation`, `packaging`. Un type `live` exige également
`provider: "claude"` ou `provider: "codex"`.

Les chemins d'artefacts et de preuves sont relatifs à la racine de projet
convenue en L00. Ils n'utilisent ni chemin absolu ni `..`. Le helper les
conserve sans les exécuter. Les logs restent dans les emplacements référencés et
doivent être accessibles au relecteur.

```bash
python3 "$CREW_WORKPACK/scripts/coordination.py" --root "$CREW_WORKPACK" submit L00 --agent claude-audit-01 --token "$CREW_TOKEN" --report "/chemin/vers/L00-claude-audit-01-attempt-1.json"
```

`submit` copie le rapport dans le registre sous un identifiant `handoff-...` et
passe le lot à `in_review`. Modifier ensuite le JSON source ne change pas la
passation enregistrée. Aucune soumission n'écrase les anciennes passations.

## 6. Relire et accepter la bonne version

Un autre agent examine la livraison. Il récupère son `handoff_id` via `submit`
ou `status L00`, puis prépare un rapport à partir de
`examples/build-review.json`.

Pour une revue documentaire, `verification_scope` vaut `documentation` ;
`source_revision` et `tested_revision` correspondent à la même empreinte ou au
même commit. Les vérifications sont de type `doc_validation`.

Pour du code, `verification_scope` vaut `combined_code`. Le relecteur indique la
révision source livrée et **la révision du candidat combiné réellement testé**.
Le rapport comporte alors aussi :

```json
{
  "integration": {
    "base_revision": "git:SHA_COMPLET_DE_LA_BASE",
    "source_revision": "git:SHA_COMPLET_DE_LA_LIVRAISON",
    "candidate_revision": "git:SHA_COMPLET_DU_CANDIDAT_TESTE",
    "evidence_ref": "validation/L01-integration.log"
  }
}
```

Les SHA de cet exemple doivent être remplacés. Le journal d'intégration doit
permettre de retrouver le lien entre base, livraison et candidat. Toutes les
vérifications du rapport de revue visent `tested_revision`. Le registre conserve
cette valeur comme `accepted_revision` après acceptation.

```bash
python3 "$CREW_WORKPACK/scripts/coordination.py" --root "$CREW_WORKPACK" accept L00 --reviewer codex-review-01 --report "/chemin/vers/L00-review.json"
```

L'acceptation exige : relecteur différent de l'auteur, passation courante,
provenance cohérente, résultats de vérification réussis, aucun `finding` restant
et aucune limitation ou étape inachevée dans la passation. Elle rend les lots
dépendants disponibles et invalide le jeton de l'exécutant.

Si une correction est nécessaire, le relecteur utilise `outcome:
"changes_requested"`, renseigne `findings`, puis lance :

```bash
python3 "$CREW_WORKPACK/scripts/coordination.py" --root "$CREW_WORKPACK" reject L00 --reviewer codex-review-01 --report "/chemin/vers/L00-review-corrections.json"
```

Un refus peut aussi intervenir **avant qu'un candidat testable existe**, par
exemple en cas de conflit de fusion. Il exige la passation courante, sa révision
source, une conclusion et des anomalies motivées. Il n'exige alors ni
`tested_revision`, ni `integration`, ni `checks` : ne pas inventer de candidat
ou de tests. Exemple minimal de fichier de refus, à renseigner avec les valeurs
réelles avant la commande précédente :

```json
{
  "handoff_id": "A_REMPLACER_PAR_PASSATION_COURANTE",
  "source_revision": "git:A_REMPLACER_PAR_SHA_COMPLET_DE_LA_LIVRAISON",
  "outcome": "changes_requested",
  "summary": "Le conflit de fusion empêche de produire un candidat testable.",
  "findings": [
    "Résoudre le conflit dans le contrat partagé et soumettre une nouvelle livraison."
  ],
  "evidence_refs": ["validation/L01/merge-conflict.log"]
}
```

`evidence_refs` est facultatif et ne référence que des preuves réellement
disponibles. Des vérifications déjà effectuées peuvent être ajoutées dans
`checks` ; leurs champs sont validés normalement. Sans `tested_revision`, elles
doivent viser `source_revision`. Lorsqu'un candidat a effectivement été testé,
le refus peut conserver `tested_revision`, `verification_scope`, `integration`
et ses preuves exactes. Les contraintes strictes de candidat combiné et de
vérifications réussies restent obligatoires pour **accepter** du code.

Le lot repasse à `in_progress` avec son propriétaire et son jeton actuels. La
revue refusée et la livraison précédente restent dans l'historique. Après les
corrections, l'auteur soumet une nouvelle passation avec la nouvelle révision.

### Derniers lots : le réel doit être vérifié

L11 et L12 exigent un rapport de revue `combined_code` avec des vérifications
`live` réussies pour **Claude et Codex**, sur la révision candidate concernée,
ainsi qu'une passation marquée `live_verification: "passed"`. Les tests simulés
du helper ne constituent jamais ces preuves.

Si une CLI, une authentification ou un environnement nécessaire est indisponible,
documenter exactement le blocage et les vérifications restantes. L'absence
d'accès n'autorise pas à inventer des résultats ni à marquer la V1 comme
fonctionnelle. Le travail indépendant continue.

## 7. Garanties et limites du registre

Le verrou exclusif `flock` sérialise les mutations. L'état, le journal et les
instantanés de notes/passations/revues sont publiés ensemble dans `STATE.json`
par écriture temporaire, synchronisation et remplacement atomique. Les IDs
uniques empêchent l'écrasement accidentel d'une note ou d'un rapport.

Avant toute lecture ou mutation, puis avant publication, le helper vérifie les
champs et les liens du registre : propriétaires, tentatives, jetons, événements,
passations et revues. Un lot `in_review` doit référencer la passation de son
propriétaire et de sa tentative courants. Un lot `accepted` doit référencer sa
revue d'acceptation par `accepted_review_id`, la passation correspondante et la
révision prouvée par `accepted_revision`. Un statut modifié isolément ne peut
donc pas débloquer une dépendance ; l'état incohérent est refusé sans écriture.

Le helper protège la **coordination coopérative**. Il ne remplace ni les droits
du système, ni une sandbox, ni la vérification indépendante des preuves. Un
identifiant de relecteur est déclaratif : le coordinateur doit réellement
attribuer la revue à une autre session. Les commandes listées dans un rapport
sont du texte ; elles ne sont jamais exécutées par le helper.

Ne jamais modifier `STATE.json` à la main ni supprimer son verrou pour forcer un
accès. Un état invalide provoque un refus sans réinitialisation silencieuse.
La modification de `lots.json` après initialisation nécessite une migration
explicite et revue de l'état ; un changement d'empreinte bloque les mutations.

Après une interruption pendant une commande, relire `status` avant de répéter
une mutation : son écriture peut avoir été effectuée avant la perte de la
réponse. Les commandes renvoient du JSON, le code de sortie est `0` pour un
succès, `1` pour un refus/erreur, `2` pour une syntaxe CLI incorrecte.

## 8. Vérifier cet utilitaire

```bash
python3 "$CREW_WORKPACK/scripts/test_coordination.py"
```

Les tests utilisent exclusivement des répertoires temporaires. Ils vérifient
notamment les claims concurrents, les dépendances, les jetons périmés, la
traçabilité du candidat testé, les rapports invalides et la préservation de
l'historique. Ils ne marquent aucun lot de ce dossier comme terminé et ne
sollicitent aucun fournisseur d'IA.
