# Reprise du chantier — 24 octobre 2026, après L07 natif partiel

## Clôture finale — état83, L00–L12 acceptés

- Produit source537d3c40f673eb2ca7b0984d695bfed90282e746, tarball947da88b8cede34df6a50d1e3b5c0fed3db006d001c976ca35b8df20550c47d1 ; aucun changement produit depuis les182tests Node24/26 et les recettes finales.
- L11 accepté avec review-7bd6ebd25d4e4e8ca147f54601a2ce8d ; L12 accepté avec review-12e6ebaeac5b434d82936c24733d1bbc. Rapports/JSON indépendants dans validation/L11 et L12. Rapport utilisateur canonique : validation/RELEASE_REPORT.md.
- Correction finale f57b56fc terminée291,6tâches accepted,3acceptations au même bb0f552826fa7ee17921ec5dadfdb50f3f472375,14tours Codex, pic3,0incomplet. Helper assert-native-correction exit0 ; isolés0/0, écheccombiné1 attendu, correctif0. Ancien run e8fb4f37 annulé et conservé comme incident, jamais compté succès.
- Configuration fixture24000restaurée et persistée après redémarrage. Tous services/QA arrêtés avec sorties observées. Le préfixe installé reste disponible et n'est pas ajouté globalement au PATH ; usage par nom vérifié dans les processus enfants de deux projets.
- Désinstallation/réinstallation du même tarball :911fichiers d'état/7projets strictement identiques avant/après, y compris après smokes installés Node24/26 ; arbres source et lignes métier identiques. Snapshots et script exact dans validation/L12, revérifiés indépendamment. Anciennes missions/critères/décisions de deux projets de test préservés.
- Huit worktrees gérés archivés, leur retrait a été vérifié ; les autres worktrees de chantier étaient propres et leurs branches sont conservées. Aucun push, PR, registre ou déploiement/production.
- Dernière étape responsable : versionner localement les preuves/Serena, vérifier diff propre et état83, puis marquer le goal terminé. Les sections suivantes sont historiques.

## Point prioritaire — source finale 537d3c4, recettes finales

### Dernier complément : correction rejouée, ancien run conservé

- Le run correctif e8fb4f37 a été annulé proprement après diagnostic indépendant : deux acceptations A/B au SHA23a01044, troisième refusée INCOMPLETE_DELIVERY car l'auteur avait rangé « tests personnels non exécutés » dans limitations. Les acceptations sont terminales ; aucune réparation publique ne peut changer le snapshot tout en gardant ces acceptations au même SHA. Aucun bypass, mutation DB, faux résultat ni modification produit. Garder cet incident avec les échecs antérieurs.
- Nouveau run correctif **`run:f57b56fc-ab6a-47af-b1d1-b446174f1d63`**, même projet222b1ea7, même basefe2197/tests/critères ; chef et auteurs/reviewers Codex pendant le quota Claude. Objectif explicite `native-correction-retry-objective.txt` : passations complètes d'abord, aucune acceptation avant validation des trois, réserves « auteur NON EXÉCUTÉ » dans next_information. Mixité déjà démontrée dans3autres recettes finales.
- Budget config de cette fixture temporairement24000→64000 via configuration publique après CONTEXT_BUDGET_EXCEEDED ; service arrêté, oldPID86458 observé sorti, puis redémarré. Rétablir24000 et arrêter le service après fin du nouveau run AVANT assertion root_clean/lifecycle. Ne supprimer aucune décision ou critère pour rentrer dans le budget.
- TUI installée réellement ouverte/détachée/rouverte dans deux PTY sur run:package-upgrade de transport : état paused version4/task1/decision1 inchangé, exit4 documenté. Rapport L11/tui-installed-report.json. Annulation de saisie vide exit130, pas d'objectif envoyé. Un projet vide native-doc-codex a été créé lors d'un essai au mauvais ID ; il est conservé, aucun provider lancé.
- Tous services autres que correction actuellement arrêtés avec sortie des PID observée. Huit worktrees gérés ont été envoyés à archive_worktree ; vérifier leur archivage effectif ultérieurement. Les autres worktrees de chantier étaient propres.
- Rapport final rédigé en **validation/RELEASE_REPORT.md** (le modèle reste intact), lignes04/09/10 et acceptation encore ouvertes. Pré-revue L11 en final-review.md, pas de JSON sans future handoff ID. Dernier script assert-native-correction.mjs est maintenant adapté au run Codex seul et contrôle toujours les3acceptations au même SHA, garde les tests isolés+échec+correctif et la branche initiale intacte.

- Produit figé `537d3c40f673eb2ca7b0984d695bfed90282e746`, 182/182 tests Node26 et Node24 ; check complet vert. Tarball final `947da88b8cede34df6a50d1e3b5c0fed3db006d001c976ca35b8df20550c47d1` dans `/Users/zeldris/.codex/avity-crew-validation/20261024/release-final/` ; préfixe installé `install prefix`, état privé `data` sous ce même dossier daté. 130 fichiers installés identiques au tarball.
- L00–L10 acceptés. L11 réservé par codex-coordinator (token privé fonctions). L12 pas encore réservé. Ne pas éditer STATE.json ; utiliser coordination.py.
- Recettes du paquet final terminées : nouvelle application `run:71469044-5ca6-473e-8e78-de2f4ad719e6`, transport `run:858ac152-b0d8-4b3f-8720-7ebec5b0a36e`, document sans Git et limite1 `run:5ce6a875-cd7e-4760-9fef-20fbb6c92387`. Rapports L11 new-app-native-report, transport-native-report, document-native-report + QA navigateur. Tous services correspondants arrêtés et QA serveurs nettoyés. Nouveau/transport : 22 tours natifs chacun, pic3 ; charge7 simulée seulement.
- Correction contrôlée EN COURS : projet `native correction final`, projet222b1ea7f3f11a39a579b09ef73a369f, run `run:e8fb4f37-7e29-4112-90c3-4e70fd4daf1d`. Isolés A/B passés, combinaison0814fdf échouée avant correctionserial. Quota Claude réel observé et conservé, run waiting_provider puis remplacement explicite chef Codex génération2. Ne plus lancer Claude pendant quota.
- Deux premières revues A/B blocked pour preuve manquante ont bloqué les auteurs ; revues ultérieures mêmes handoffs rejetées STALE_REVIEW car statut blocked. Diagnostic indépendant `validation/L11/correction-review-diagnostic.md` : voie officielle redélégation des auteurs, nouvelles passations puis preuves/revues sur candidat courant. Réponse à question-stale-review-binding envoyée par CLI, aucun bypass/modification de critère/source métier. Chef doit aussi traiter les deux missions reviewer evidence bloquées.
- Restant : finir correction native, produire son rapport et assertions ; arrêter tout service ; empreintes état avant/après désinstallation/réinstallation du même tarball ; confirmer deux projets et ancien état de test conservés ; remplir RELEASE_REPORT/matrice ; passation/revue indépendante L11 puis L12 ; conserver preuves/Serena par commit local ; nettoyer worktrees de chantier ; finir goal. Aucune publication, push, PR ou production autorisée.
- Outil `validation/L12/snapshot-package-state.mjs` prépare empreintes globales fichiers et état métier SQLite sans exposer contenu privé. Ne l'utiliser pour empreinte fichiers qu'après arrêt observé des services. Linux/Windows/WSL et CI distante non exécutés.

L'état ci-dessous est historique et ne remplace pas ce point.

## Mise à jour prioritaire — après f0d0d07 (lire avant l’état historique ci-dessous)

- HEAD produit `f0d0d077e1ed5464f9dc6e476403e6e349c39bf7` : tous raccords
  main/coordinator/runtime/Store décrits ci-dessous sont désormais intégrés et
  compilent. **167/167 tests Node26 et Node24**, zéro skip, check complet vert.
- Store plan/control/config `7a4e794` intégré en `7ded916`. Configuration après
  init et contexte après250événements testés réellement via daemon/HTTP. Snapshot
  run_state est maintenant résumé avec accès aux détails : la version intégrale
  avait fait échouer deux tests sous le budget ; critères Run et brief affecté
  restent complets. Ancienne preuve doit correspondre aux critères et à l’Attempt
  courants (`STALE_EVIDENCE`) ; régression complémentaire en cours par spécialiste.
- **Le run natif n’est PLUS en pause.** Service relancé et resume sur f0d0d07.
  Dernier curseur656/version202 : chef Claude a employé record_decision/amend_task,
  writer resoumis `handoff-doc-recette-g6`, tâche writer in_review, ancien reviewer
  accepted, nouveau `task-review-recette-v2` Codex réellement running. Global
  criterion:2 conservé ; pas encore de clôture réelle constatée. Une CLI modèle
  active max1. Vérifier status avant tout nouveau lancement/arrêt.
- Agent acceptance_map : test négatif ancienne preuve mêmeSHA/aprèsamend, fichier
  tests/plan-state.test.ts seulement ; Agent provider_audit : revue readonly f0d0d07
  (25 ciblés déjà verts, probes finaux) ; Agent l05_codex : mission tests/load.test.ts
  charge7 **simulée** reçue mais interrompue temporairement pour budget4 (root +
  testeur + reviewer +1CLI native). Le relancer via followup dès place libre.
- Flake zombie corrigé par barrière child-pid avant beat, `812e708` intégré
  `b8fc27b`, sans délai/asser­tions affaiblis. Docs README/INSTALLATION encore
  historiques sur configpostinit et qualification : à actualiser avant release.

L’objectif actif reste la construction complète L00–L12 du mandat déjà lu :
`/Users/zeldris/.codex/attachments/7af81fce-7f04-40e7-a46c-b5734fe6e007/goal-objective.md`.
Ne pas marquer le goal terminé avant recettes et paquet final. Aucune publication
externe/production. Git local/commits/worktrees nécessaires autorisés.

## Sources et état

- Repo `/Users/zeldris/avity-crew`, branche `build/avity-crew`.
- Registre canonique `/Users/zeldris/avity-crew/avity-crew-workpack`.
  Utiliser exclusivement `python3 <workpack>/scripts/coordination.py --root <workpack> ...`.
  Jamais d’édition directe de STATE.json.
- L00 à L06 acceptés. L05 review `review-154142381c7a4330aff49bb8144e6376` ;
  L06 review `review-be8a267d7d2d4bd2977b1c0f4de570ec` après deux corrections.
- L07 réclamé par codex-coordinator, en cours, jeton sauvegardé dans functions
  store `l07_claim` (ne pas l’afficher). L08–L12 non réclamés ; leurs sous-tâches
  indépendantes ont été préparées sans prétendre clôturer leurs dépendances.
- Source complète validée `76fe256af8b9c7b58d705acf46f1c18f7df52b9c` :
  **151/151 tests Node26 et Node24**, types/format/build verts, zéro skip.
- Commits suivants intégrés : `76b685a` manifest/export supervisor,
  `f83666c` canonique amend_task, `4598bf1` contrat amend_task,
  `6591ec0` description outil, puis `5409595` test inspection (cherry local).
- IMPORTANT : root a des modifications produit NON COMMITTÉES dans main.ts,
  coordinator.ts et runtime.ts : bootstrap config après verrou, dispatch
  amend_task + scopedSpec partagé, inspection paginée avec prompt/inspection exacts.
  Elles dépendent des méthodes Store à venir ; compiler après intégration.

## Produit actuel

TypeScript strict ESM/npm workspaces, Node>=24.15 référence24.22.1, SQLite réel,
Ajv schémas stricts versionnés, natifs Claude2.1.304 et Codex0.163.0.
CLI asynchrone complète et TTY français (multiligne/Unicode/redimensionnement/q
détache), HTTP loopback authentifié, MCP stdio et internal call même API.
Chef hors TaskSpec/DAG, slots de tours incluant chef, max1 testé sans deadlock.
Contexte exact conservé en artefacts + bundle ; sources privées exclues.
Worktrees/snapshots/candidats Git/CAS/ports et ressources, aucune modification du
dossier principal ; ref de livraison dédiée. Documentation sans Git.
Passations capturées par serveur via document_paths (aucun faux hash d’entrée),
revues indépendantes, acceptation vérifiée, fin par preuves et critères.
Capacités durée-tour révoquées en finally et toutes révoquées à réacquisition du
service ; owner.key reste stable. Reprise de PID avec naissance/commande/groupe
observés, pas de reprise sur simple heartbeat/silence, incertitudes refusées.

Commandes vérifiées : `npm run check`, puis `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'`.
README/CHANGELOG/docs INSTALLATION/USAGE intégrés `5beb496`, qualification limitée
explicite. Tarball testé par spécialiste sur état antérieur ; à refaire final.

## Recette native EN COURS — lire son état avant toute action

- Projet hors repo : `/Users/zeldris/.codex/avity-crew-validation/20261024/native-doc-claude`.
- Env uniquement pour données Avity :
  `XDG_DATA_HOME=/Users/zeldris/.codex/avity-crew-validation/20261024/data`.
  Ne pas modifier HOME/CODEX_HOME ni copier l’authentification.
- Run `run:6eb68e3b-a22b-4920-9ab7-b4d0a10f37e6`, **PAUSED explicitement**.
  Service tourne sur source76fe256, aucun CLI modèle actif au dernier constat.
- Objectif docs/recette.md marqueur AVITY_CREW_NATIVE_CLAUDE, deux critères :
  document correct et revue/acceptation/clôture. Chef Claude ; writer Claude ;
  reviewer Codex réel. File écrit/capturé, hash manifest
  `sha256:88402fd2d4118062b0c7893cbe617311409dab29b5d105196a0964b95428bb12`.
- Première source4c003ca a révélé effet identité répété sur chaque événement ;
  corrigé8443136, régression PID enfant réel+doublons session+textes.
  UUID pré-hook initial non repris (No conversation found) : conservé comme échec,
  remplacement chef explicite génération2, aucun faux succès/fallback caché.
- API hash avant capture ensuite corrigée document_paths en0128e43+cba6f14 ;
  accords MCP mutants réels fonctionnent pour Claude ET Codex (submit_review).
- État natif actuel : writer `task-doc-recette` in_review, reviewer
  `task-review-recette` accepted, Review approved mais writer revendique seulement
  criterion:1 et indique des limitations (critère2 est du contrôle). Accept refuse.
  Le chef ne peut pas corriger TaskSpec avec l’ancienne API ; c’est le travail
  amend_task/ControlResult actuel. **Ne pas forcer claim2 ni supprimer critèreRun**.
- Pour reprendre après fix : build, service stop/start depuis ce projet avec env,
  puis resume du run. Garder objectif/critères, laisser chef employer amend_task
  et déléguer une nouvelle passation/revue ; nouveau contexte explique la méthode.
- CLI exemple statut borné : node /Users/zeldris/avity-crew/bin/avity-crew.mjs status
  --run <id> --after-seq 300 --limit 200 --json. Parser/filtrer via context-mode,
  ne pas afficher tout le journal. Dernier curseur observé499, version141.
- Un deuxième dossier `native-doc-codex` existe, aucun run commencé.

## Agents vivants et propriété

1. `/root/l00_acceptance_map` travaille **L08 plan/state**, worktree
   `/Users/zeldris/.codex/worktrees/avity-crew-l08-plan-state`, branche
   `build/l08-plan-state`, base76fe256. Scope Store/index.ts + nouveau
   tests/plan-state.test.ts + docs/STORAGE.md. Implémente :
   `amendTask(actor,{task,reason,decision_id},key,version)` ; décision approuvée,
   writer arrêté, DAG, TaskSpec historique/task_revision, generation fencing,
   aucune modification Run.criteria/objective/constraints. Ajoute snapshot Review
   + Verification static/manual/null command + control_result ; finishRun compte
   seulement contrôles approuvés référencés par une acceptation courante.
   `configureProject(config):void` interne, transaction config seule, appel après
   verrou singleton par rootmain, persiste changement post-init sans toucher runs.
   Clear wait_reason obsolète quand nouvelle tentative/passation reprend.
   Premier rouge/vert writerAC1+reviewerAC2 obtenu, contrôles négatifs en cours.
2. `/root/l05_codex` a livré contrat amend_task `6c5a00f...` déjà intégré4598bf1,
   et matrice `validation/L11/remaining-acceptance.md`. Idle.
3. `/root/l00_provider_audit` a livré revue indépendante 5 findings clos sur9dd,
   puis capture/caps revue sans nouveau constat sur76fe256. Rapports L07.
   Test inspection long journal `54095955f72a48cffebf4a7187eabcd6c8567668` intégré.
   Travaille maintenant UNIQUEMENT tests/config-reload.test.ts dans worktree
   `/Users/zeldris/.codex/worktrees/context-inspection-regression/avity-crew`
   (ou nouvel isolé annoncé). Test daemon sans modèle : config fichier modifiée
   post-init appliquée durablement après restart depuis sous-dossier Git.

## Prochaines étapes

1. Intégrer Store amend/control/config sans doublonner schémas ; finir raccord root
   tools/coordinator/runtime/main et prompts (contrôle séparé des critères writer,
   limitations bloquantes vs next_information). Tester final, revue indépendante.
2. Consommer test inspection et config ; vérifier 151+ nouveaux tests Node26/24.
3. Reprendre recette native paused, produire clôture réelle puis chef Codex et
   code2writers mixtes simultanés, correction réelle, qualification jusqu’à7,
   incidents/reprise et E2E01–12 selon matrice. Ne pas recycler preuves7fb L05
   en preuve du candidat final L11/L12.
4. Passations/acceptations formelles L07→L12, docs/changelog/mémoires Serena fiables,
   paquet final npm pack, installation propre deuxprojets/pathespaces, artefact hash.
5. Préserver tous rapports non suivis ; aucune publication/push/production.

Root garde intégration, productruntime, manifests/lock/exports. Max4 places de
construction en comptant root, spécialistes actifs et CLI modèles ; pas de
délégation récursive. Native actuellement paused donc créneau libre.
Context-mode obligatoire, pas curl/wget ni gros outputs. Compaction : chercher
continuité puis ce checkpoint et registre avant questions. Serena initialisé mais
cache symbolique Python initial empêchait TS ; navigation ciblée ctx utilisée.
# Checkpoint prioritaire — 24 octobre 2026, candidat installé ccbab6f

- HEAD produit gelé `ccbab6f1551c2f54056bece878b229377f1ef52f`. **177/177** tests Node26 et Node24, zéro skip ; type/format/build verts. Les anciens checkpoints ci-dessous sont historiques.
- L07 soumis, `handoff-b64a75d84a124114b18b95d0efa75b5d`, attente revue indépendante. L00–L06 acceptés ; L08–L12 non claimés. Token L07 dans functions store `l07_claim` (ne pas imprimer).
- Correctifs nouveaux : 6983f6e/7f301ea revalidation capabilities queue/préparation/promotion ; 6c33d05 projection noms/descriptions outils (schémas natifs exclus du prompt) ; ccbab6f préserve reason required_source pour AGENTS entre worktrees. Régressions indépendantes rouges avant, vertes après.
- E2E simulé correction combinée complet : isolées A/B passent, combinaison échoue, tâche corrective explicite, nouveau candidat testé/revu/accepté, clôture. Aucun critère ou fonctionnalité retiré.
- Tarball final local : `/Users/zeldris/.codex/avity-crew-validation/20261024/release-final/avity-crew-0.1.0.tgz`, SHA256 `5bafe43252c360d584c72a6b8cc6fe9e5734b73f128047a96381e47afe1acf3a`, 130 fichiers, aucun état privé/chemin absolu de développement détecté. Installé dans `.../20261024/install prefix`, binaire `bin/avity-crew`.
- Deux projets réels : `.../20261024/native-new-app` (project887595b9d9765b18cfe0fe5e5570f9cb), `.../20261024/native transport fixture` (project4125dcc47d867f92f1d8b61235deef81). Env unique `XDG_DATA_HOME=.../20261024/data`. Init/doctor installés verts, mise à jour depuis db33d66 puis c71b313 conserve runs/tâches/décisions/critères/pause via validation/L12/package-state.mjs. Aucun objectif natif final encore passé sur ce candidat.
- Run natif c71b313 `run:050e045a-f750-4f50-939b-88b030fdf8da` annulé avant exécution workers pour bug AGENTS requis. Garder cet incident ; ne pas le compter réussi. Nouveau run à démarrer depuis le binaire installé ccbab6f, objectif fichier `.../20261024/native-new-app-objective.txt` et 3 critères explicites.
- Fixture transport baseline Git 7df577b ; app nouvelle baseline fa91559. Contrats/tests indépendants fournis et rouges avant implémentation. Sources hors repo de développement, aucune production. Pour transport utiliser le chemin AVEC espaces ci-dessus ; objectif `.../20261024/native-transport-objective.txt`.
- Permissions natives installées ccbab6f : Claude et Codex refus MCP réels, error permission, success false, tools/call0. Détails validation/L11/native-permissions.json. Premier essai Codex annoté autoautorisé, explicitement exclu des preuves de refus. Aucun quota réel épuisé.
- Agents : acceptance_map termine (test AGENTS 2/2 Node24/26, review diff sans finding), provider_audit révise runtime L07/L08/L10, l05_codex révise transport L07/CLI L09. Attendre leur fin avant natif max3 : root + chief +2workers =4 places de construction, aucun agent supplémentaire simultané.
- Reste : native app Claude chief +2mixed workers réellement simultanés, transport Codex chief +Claude worker, recettes contexte/chief replacement/reprise finales, acceptations L07→L12, désinstallation sans perte et rapport final. Pas de publication/remote push/déploiement. Ne pas clore le goal avant preuves requises.

- **PLUS RÉCENT — reprise applicative en pause :** run `run:49d968f4-4883-4e00-b612-d9dc26df9309` lancé depuis le paquet ccbab6f. Chef Claude et auteurs Claude/Codex réellement simultanés (deux PID vérifiés vivants). Pause a interrompu UI via SIGINT avec public/index.html + README conservés ; serveur déjà livré. Service redémarré, chef remplacé par Codex génération2, UI repartie dans tentative93b3... depuis snapshot partiel3969db... La décision approuvée `decision:api-contract-v2` remplace api-contract, cible UI et demande focus du champ après création ; message ciblé `message:ef38b43e9a4c0a2959dc79cd090cf438`. Ancienne autorité native UI refusée REVOKED_CAPABILITY. Puis candidat combiné a échoué : collectDelivery ancre la livraison finale sur le snapshot partiel P, donc cherry-pick du seul dernier delta S sur base originale B perd les fichiers initiaux. **Tous natifs PAUSÉS** pour correction, aucun candidat accepté. Correctif PRODUIT NON COMMIS dans packages/workspace/src/index.ts : TaskSpec.base_revision devient baseline cumulative de delivery/diff/commit-tree ; garde ancestry TaskBase→workspaceBase et BASE_CHANGED si incompatible. Check177 vert ; agent acceptance_map écrit régression réelle, provider_audit révise diff. Attendre leurs résultats, tests complets/commit, refaire tarball+install car SHA installé actuel est désormais historique. L07 accepté review2d4364... ; L08 claim store l08_claim, in_progress. Ne pas perdre les fichiers ni relancer en double. Ancien run050e... reste annulé. Les checkpoints ci-dessous précèdent ce correctif.

- **CHECKPOINT ENCORE PLUS RÉCENT — source b0571ad installée :** HEAD `b0571ad56aa5a63768537fbfe4bdcd9639c2954e`, source produit acaa22c (collecte cumulative TaskBase + garde), tests e3ca42e (4 régressions), docs5c7f172, fixture reconnexion b0571ad attend premier snapshot (6 répétitions vertes). `npm run check` et Node24 global **181/181**, zéro skip, source exacte b0571ad. Tarball FINAL courant SHA256 `f51a3216c854c0015ac8eff984e3d9f9e976aa2f9de98d8f470198cc1308730c`, 130 fichiers, installé même prefix ; anciens paquets archivés release-old. Données2projets conservées après mise à jour. Permissions natives Claude/Codex rejouées avec succès attendu/refus sur ce paquet (native-permissions.json, nouveauxUUID). Tous spécialistes actuellement terminés. Run49d... a été repris sur b0571ad (histoire antérieure ccbab6f à conserver), chef Codex gen2. IMPORTANT : chef avait amendé TaskSpec UI base=S05672 comme contournement avant fix ; root a envoyé message explicite lui demandant décision approuvée + amend_task pour restaurer base originale Bfa91559 avant délégation, puis pause/resume. Dernier état natif RUNNING, aucun succès final ; vérifier progression via validation/L11/native-status.mjs et binaire installé. Ne pas relancer de work en double. Reste recette transport ENTIÈREMENT sur b0571ad (Codex chef, Claude/Codex workers, chemin avec espaces), revues/formal lots L08→12, désinstallation sans perte, rapport final. Aucun produit à modifier sans bug nouveau. Les checkpoints suivants sont historiques.

- **DERNIER CHECKPOINT PRIORITAIRE — 537d3c4 / 182 tests :** HEAD produit+tests `537d3c40f673eb2ca7b0984d695bfed90282e746`. Nouveau fix80e3930 déplace capture recovery dans try APRÈS claim (délégation consommée), régression ccc7948 intégrée537d3c4 ; erreur préparation = exited pidnull/blocked/une seule erreur, indépendants avancent. Revue provider_audit et test acceptance_map rouges avant/verts après, tous deux terminés. **182/182 Node26 et Node24**, zéro skip, check complet vert. Tarball FINAL courant SHA `947da88b8cede34df6a50d1e3b5c0fed3db006d001c976ca35b8df20550c47d1`,130fichiers ; installé prefix identique ; donnée2anciensprojets préservée. Permissions natives Claude/Codex rejouées sur537d3c4 (native-permissions.json). Ancien run49d ANNULÉ, fichiers/candidats/échecs conservés, ne pas reprendre ; historique dans native-development-incidents.md.
- **RECETTE NATIVE PROPRE ACTIVE** : projet `/Users/zeldris/.codex/avity-crew-validation/20261024/native new app final`, project_id `project:1a121d7e95c2fc3d1965e22469d3c29b`, run **`run:71469044-5ca6-473e-8e78-de2f4ad719e6`**, ENTIÈREMENT depuis paquet537d3c4. Git clone local --no-local --single-branch main =1commitfa91559,3fichiers d'entrée seulement, pas d'application/anciensobjets. ChefClaude a délégué deux auteurs mixtes natifs simultanés ; source IDs requis OK. UI interrompue AVANT handoff avec fichiers présents : attempt11edf3c1-1c4c-430f-9e2c-80b08421ad07 SIGINT/interrupted. Hashs conservés après arrêt puis redémarrage service : public/index.html7e472cfe71bf1fd48f0821e6f563eb0f146d74496ef3d234788e1d1cbf981883, README d8a54a1c6f2c526b46d4b5baed9fd7679af94fb2e6166a0e6e6dd1e1bdc50a08. PENDANT PAUSE, ownerSDK a enregistré décision approuvée decision:api-contract-v2 qui supersedes decision:notes-contract, conserve tout contrat et ajoute focus+viderchamp aprèssuccès, cible UIseule. Messages ciblés envoyés AVANT reprise. ServicePID ancien mort constaté, fichiershashidentiques, chef remplacé Codex gen2 puis resume. DERNIER ÉTAT running version122 seq383 : serveur in_review, UIrunning nouvelleattempt b7a7c148-be7d-4c93-896a-d194f62c798a, chefCodexactif. Aucune base assignée amendée, Bfa91559 conservée ; on attend livraison cumulative puis combinaison/revues/acceptations/finish. NE PAS INTERRUPTRE ENCORE/dupliquer les agents. Pas de spécialistes pendant nativepeak3 (root+3CLIs=4places).
- Utiliser `node validation/L11/native-status.mjs PREFIX DATAHOME PROJECT RUN AFTER` via ctx (maxBuffer) ; helper imprime résumé et payload.message/code maintenant. Préfixe `/Users/zeldris/.codex/avity-crew-validation/20261024/install prefix`, DATAHOME `.../20261024/data`. App objective `.../20261024/native-new-app-objective.txt`. Reste ensuite transport propre Codexchef+Claude/Codex auteurs depuis `/Users/zeldris/.codex/avity-crew-validation/20261024/native transport fixture`, objectif native-transport-objective.txt. L07 accepté, L08 in_progress claim cached l08_claim ; L09–L12 non claimés. Revues formelles finales après arrêtCLIs, désinstall conservation et rapport/commits preuves à faire. Les checkpoints ci-dessous sont HISTORIQUES.

