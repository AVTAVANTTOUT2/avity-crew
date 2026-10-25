# 002 — Corrections de l'audit fonctionnel du 25 octobre 2026

Décision de maintenance, 25 octobre 2026. Elle consigne les choix faits en
corrigeant l'audit fonctionnel et les écarts assumés avec le cahier initial
`avity-crew-workpack/docs/DATA_MODEL.md`. Le cahier reste la spécification
historique du chantier ; il n'est pas réécrit. Sur les points ci-dessous, le
code et la documentation produit (`docs/STORAGE.md`, `docs/CLI.md`,
`docs/PROTOCOL.md`) font foi.

## Comportements corrigés

- **Run par défaut.** Sans `--run`, le service observe le run non terminé le plus
  récent, puis à défaut le dernier créé (`Store.currentRun`). `status`, `watch`,
  `attach` et l'entrée interactive désignent ainsi le même run.
- **Pause et arrêt.** Un tour dont le processus est sorti peut encore vérifier
  ses snapshots documentaires (budget de 10 s). La commande attend la fin
  observée du tour (15 s au plus ; le client accorde 30 s aux contrôles). Au-delà,
  le run reste suspendu, aucun tour ne démarre, la commande répond
  `CONTROL_IN_PROGRESS` et l'état demandé s'applique dès la fin observée.
- **Identifiants de tâche.** Ils sont propres à un run : migration 3 vers la clé
  `(run_id, id)`, `getTask(runId, id)`, refus explicite `TASK_EXISTS` d'un doublon
  dans un même run.
- **Page `get_status`.** Le plafond s'applique dès le premier événement : un
  événement trop grand est remplacé par son enveloppe (`payload.omitted`) ; pour un
  agent, les listes sont raccourcies (`record_limit`) afin de garder la place des
  événements. L'export conserve les événements entiers.
- **Journal des outils.** Une opération `tool.*` en échec est close `failed`. Une
  reprise avec la même clé est journalisée comme une nouvelle tentative, ce qui
  préserve la reprise après réponse perdue.
- **Binaires fournisseurs.** Seuls les répertoires absolus du `PATH` sont
  parcourus, pour Claude comme pour Codex, et le lancement utilise le chemin
  sondé. Une entrée vide ou relative désignerait le répertoire courant du
  processus qui cherche : le service pour la sonde, le workspace pour le lancement.
- **Brief.** Le statut Git transmis aux agents omet les chemins sensibles déjà
  exclus de la lecture (`.env`, clés, répertoires d'identifiants) et indique
  combien ont été omis.
- **CLI.** Fichier objectif absent ou illisible : `CLI_USAGE`, code 2.
  `GIT_INITIALIZATION_REQUIRED` : action corrective affichée, code 2.
  `export --json` sans `--format` produit le rapport JSON. `status` distingue
  `Run :` et `Objectif :`.

## Écarts avec le cahier DATA_MODEL

- **Délégation et tentative.** `delegateTask` enregistre une délégation `queued`
  sans tentative. La tentative naît dans `claimTask`, au lancement effectif par le
  service, qui passe alors la tâche de prête à en cours. Le cahier fusionnait ces
  deux étapes ; leur séparation permet à la délégation de rendre la main sans
  attendre une place libre.
- **Statut `planned`.** Il reste dans le schéma et la table de transitions pour
  compatibilité ; `createTask` produit directement `ready` ou `waiting_dependency`
  selon les dépendances.
- **Provenance des décisions.** `recordDecision` retourne désormais la décision
  persistée, provenance comprise, comme une relecture en base.
- **Preuves `live`.** `assertLiveVerification` garde l'entrée des preuves
  (`saveVerification` et vérifications déclarées dans un handoff) : une preuve
  `live` attribuée à `fake` est refusée. Les preuves produites par le service
  restent `static`, issues d'une commande réellement exécutée ; ce mode ne prétend
  à aucune recette live.

## Constat non reproduit

Ctrl+J insère bien une ligne dans la TUI : en mode brut le terminal envoie LF,
que le décodeur de Node nomme `enter`, et ce nom insère une ligne. Un test qui
passe par ce décodeur sur les octets bruts le garantit désormais.
