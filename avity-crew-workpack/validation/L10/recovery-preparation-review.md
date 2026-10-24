# L10 — Revue ciblée de la préparation après récupération

Révision examinée : `80e39304e8cbcb29f56bde2b9c757daf01a01803`. Relecteur : `l00_provider_audit`, indépendant de l'auteur du correctif runtime. Conclusion : **aucun finding bloquant dans ce diff borné**.

## Comportement et lecture du correctif

Le diff porte uniquement sur `packages/supervisor/src/runtime.ts` : la recherche de l'ancienne session et de son workspace reste synchrone ; `reassignTask`, puis `claimTask`, précèdent désormais la capture asynchrone. La capture est déplacée dans le `try` déjà chargé de traiter les erreurs de préparation. Le claim consomme la délégation avant le premier `await` faillible. Si la capture refuse une ancienne base, le catch existant termine la nouvelle tentative avec `status=exited`, `pid=null`, `exit_code=null`, puis bloque cette tâche avec la raison explicite. Le réveil du scheduler ne retrouve plus cette délégation parmi les entrées `queued`.

Cette transition reste locale à la tâche. Le run ne passe pas globalement en état bloqué, le travail de préparation rend sa place et les délégations indépendantes restent exécutables. Aucun nouveau contrat, état ou changement de création de workspace n'est ajouté.

## Preuve indépendante avant/après

Probe hors ligne exécuté sur des projets temporaires avec Git réel et le Store SQLite réel, en réutilisant la fixture workspace. Le fichier runtime est extrait par `git show REV:packages/supervisor/src/runtime.ts`, puis transpilé dans un dossier temporaire ; les autres modules proviennent du build local. Les seuls fournisseurs employés sont des `FakeProvider` explicitement simulés. Aucun fournisseur natif ni modèle n'a été lancé. Les dossiers et bases du probe ont été nettoyés.

Scénario : une tentative interrompue possède un workspace contenant `partial.txt`. Une décision approuvée amende ensuite la tâche vers une nouvelle base Git absente de cet ancien workspace. Une délégation de reprise et une tâche indépendante sont mises en file ; le run est limité à une place active.

| Observation | Avant : `b0571ad56aa5a63768537fbfe4bdcd9639c2954e` | Après : `80e39304e8cbcb29f56bde2b9c757daf01a01803` |
|---|---|---|
| Capture refusée | Deux appels directs à `worker()` renvoient chacun `BASE_CHANGED` | Un seul événement `turn.launch_failed` du worker, y compris après un nouveau réveil |
| Délégation concernée | `queued` après chaque échec | `claimed` |
| Tâche concernée | `waiting_provider`, ancienne tentative inchangée et `interrupted` | `blocked`, raison « The task baseline is not an ancestor of this workspace; reassign from the current baseline » |
| Nouvelle tentative de préparation | Absente | `exited`, PID et code de sortie nuls |
| Indépendance | Le probe avant ne lance pas le scheduler, pour éviter la boucle connue | Le scheduler réel lance puis termine le tour simulé de la tâche indépendante ; run toujours `running` |
| Conservation | Ancien workspace de départ conservé | `partial.txt` et ancien enregistrement de session toujours présents |

La lecture du filtre des délégations et les transitions réelles observées corroborent la fin de la boucle : la nouvelle tentative est consommée et son échec devient visible, sans nouvelle sélection automatique de cette délégation.

## Portée des validations et limite

Le coordinateur rapporte `npm run check` **181/181** sur ce correctif ; cette suite globale n'a pas été rejouée par ce relecteur. Les preuves indépendantes ci-dessus sont les probes avant/après, la lecture du diff final et le scénario avec une tâche indépendante à capacité un. Le test persistant de régression relève de l'agent acceptance, séparément de cette revue. Aucun essai natif n'est revendiqué ici ; l'incident natif historique demeure un échec conservé.

La conservation d'un ancien workspace et de sa session ne garantit pas l'import automatique d'un contenu dont la capture a échoué. La tâche bloquée exige un nouvel ordre explicite de récupération ou de réaffectation. Cette revue ne promet ni la reprise automatique de l'ancien contenu ni la modification d'une ancienne livraison.
