# Livraison locale Avity Crew 0.1.0 — 24 octobre 2026

**Accepté localement sur macOS arm64 : L00 à L12 acceptés, état de coordination83.** La cible de portabilité complète reste non vérifiée.

## Version et artefacts

- Produit CLI/TUI TypeScript/SQLite dans `/Users/zeldris/avity-crew` ; le workpack organise sa construction et n'est pas son moteur.
- Source produit : `537d3c40f673eb2ca7b0984d695bfed90282e746`, branche `build/avity-crew`.
- Tarball : `/Users/zeldris/.codex/avity-crew-validation/20261024/release-final/avity-crew-0.1.0.tgz`.
- SHA-256 : `947da88b8cede34df6a50d1e3b5c0fed3db006d001c976ca35b8df20550c47d1`.
- Préfixe installé : `/Users/zeldris/.codex/avity-crew-validation/20261024/install prefix` ; état privé dans le dossier `data` voisin ; projets de recette conservés.
- Livraison locale : aucun registre, push, PR, déploiement ou système de production modifié.

## Fonctionnement livré

Le superviseur local authentifié persiste objectifs, missions, décisions, questions, preuves et sessions. Le chef Claude ou Codex délègue des missions contextualisées à des conversations natives distinctes. Les workers utilisent des worktrees isolés ; le mode documentaire accepte des empreintes sans Git. Le service prépare et teste le candidat combiné, exige ses revues indépendantes, puis autorise une promotion distincte et une clôture fondée sur les critères.

CLI et TUI permettent conversation, réponse aux questions, état, inspection du contexte, export, reprise et changement de chef. Fermer la vue laisse le service actif. Une pause interrompt les tours observés et révoque leurs capacités ; les fichiers partiels sont conservés. La reprise recueille le diff cumulatif depuis la base de mission. Les effets incertains restent visibles et exigent une action explicite lorsqu'ils ne peuvent pas être réconciliés sûrement.

## Matrice de recette

Recettes finales : tarball ci-dessus, source `537d3c4`, macOS arm64 et Node26.12.0. Les chemins de preuve sont relatifs à ce dossier.

| Cas | Niveau et résultat | Preuve |
| --- | --- | --- |
| E2E-01 nouvelle application | Live : API Claude/UI Codex parallèles, HTTP, persistance, trois écritures concurrentes et navigateur ; 5 tâches acceptées, candidat `1a82bbfb58223460449bffa2ca3cf257e4f30879`. | L11/new-app-native-report.json ; new-app-browser-qa.json |
| E2E-02 projet existant | Live : planning chauffeur sur fixture transport, parcours employeur préservé, droits et isolation, vrai SQLite, unicité concurrente et formulaire périmé ; 6 tâches acceptées, candidat `6be7d7e2d26e5b2aed86b73ad687a3a14a03963f`. | L11/transport-native-report.json ; transport-browser-qa.json |
| E2E-03 deux chefs | Live : application chef Claude/auteur Codex puis chef Codex ; transport et document chef Codex/auteur Claude. | Rapports natifs application, transport et document |
| E2E-04 correction | Live Codex : deux isolés passent, combinaison échoue, tâche corrective distincte, nouveau candidat contrôlé, 3 revues approuvées, 6 tâches et 3 livraisons acceptées au SHA bb0f552826fa7ee17921ec5dadfdb50f3f472375 ; clôture justifiée. | L11/correction-native-report.json ; assert-native-correction.mjs |
| E2E-05 contexte actualisé | Live : décision UI v2 approuvée pendant pause, ancienne décision superseded, nouvelle version ciblée UI ; champ vidé/refocalisé observé. Budgets et exclusions testés séparément. | L11/new-app-native-report.json ; new-app-browser-qa.json ; L03 |
| E2E-06 reprise/fermeture | Live : interruption UI avant handoff, empreintes identiques après arrêt observé et redémarrage, nouvelle tentative, remplacement du chef et clôture. TUI installée ouverte/détachée/rouverte dans deux PTY, état inchangé. Reconnexion, déduplication et rejet des tentatives périmées testés. | L10/final-review.md ; L11/new-app-native-report.json ; tui-installed-report.json ; L09/final-review.md |
| E2E-07 sept places | Simulé : 7 places, scheduler7, processus7, workspaces7, zéro CLI LLM ; rejoué Node24/26 au SHA final. Live : pic3, dont observation OS explicite. | L11/final-load-report.json ; native-process-observation.json |
| E2E-08 permission/quota/question | Simulé : quota/auth/réseau, poursuite indépendante et reprise. Live : diagnostic et refus MCP contrôlé de chaque provider ; question/réponse liée. Quota Claude survenu naturellement pendant correction, attente conservée et reprise explicite Codex. | L11/native-permissions.json ; new-app-native-report.json ; correction-review-diagnostic.md |
| E2E-09 intégration cohérente | Live : A/B isolés passent ; combinaison e9163de0 échoue2>1 avant décision/tâche ; correction limitée à policy.json conserve les deux fonctions et capacity1. Les contrôles finaux et 3 acceptations visent bb0f5528. Branche initiale et tests intacts. Régression déterministe rouge puis verte. | L11/correction-native-report.json ; assert-native-correction.mjs |
| E2E-10 installation/deux projets | Pack installé proprement, utilisé par tous les runs finaux ; 130 fichiers conformes, assets présents. Désinstallation puis réinstallation exactes : 911 fichiers d'état/7 projets identiques, sources et lignes métier SQLite conservées ; deux anciens runs paused inchangés ; commandes Node24/26 installées réussies. | L12/package-content.json ; package-installation.json ; lifecycle-report.json ; lifecycle-before.json ; lifecycle-after.json |
| E2E-11 sans Git | Live : document français de 12 lignes, empreinte exacte, auteur Claude/reviewer Codex distincts, preuves manuelle command:null et automatique ; 2 tâches acceptées et clôture ; aucun .git créé. | L11/document-native-report.json |
| E2E-12 une place | Live : chef, auteur et reviewer successifs ; limite1/pic1, 6 tours terminés, aucun incomplet. | L11/document-native-report.json |

## Correspondance des exigences

| Exigences | Preuves principales |
| --- | --- |
| R01 installation/projets | L12 ; projets natifs distincts avec espaces |
| R02 objectifs génériques | E2E-01,02,11 ; L08/final-review.md |
| R03 connaissance sourcée, R04 prompts ciblés | L03 ; E2E-05 ; L08/final-review.md |
| R05 chef interchangeable, R06 sessions mixtes | E2E-03 ; rapports natifs et IDs de sessions ; L04/L05 |
| R07 dépendances/correction, R08 notes/questions/décisions | L02 ; L08 ; E2E-04,05,08,09 |
| R09 passations/documentation, R11 fin sur preuves | L08 ; refus MISSING_EVIDENCE/INVALID_PROVENANCE conservés ; E2E-04,09,11 |
| R10 isolation/intégration | L06 ; E2E-01,02,09 ; branches initiales préservées |
| R12 reprise | L10/final-review.md ; E2E-06 |
| R13 concurrence/limites | E2E-07,08,12 ; L11/final-load-report.json |
| R14 CLI/TUI | L09/final-review.md ; E2E-06 |
| R15 permissions/authentification | L07/final-runtime-review.md, queued-authority-review.md ; L11/native-permissions.json |
| R16 construction/portabilité | L11/final-checks.md ; L12 ; matrice ci-dessous |

## Tests et revues

- `npm run check` : types, format, compilation et **182/182 tests réussis**, zéro skip, Node26.12.0.
- `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` : **182/182 réussis**, zéro skip.
- Contrôles finaux également exécutés par un relecteur distinct. L08/L09/L10 revus sur `537d3c4`. Révocation asynchrone, contexte obligatoire, capture cumulative et préparation de reprise ont leurs régressions et revues ciblées.
- `.github/workflows/check.yml` prévoit Node24/26, lockfile, check et empaquetage hors ligne fournisseur. **CI distante NON EXÉCUTÉE** : aucun push demandé.
- Recettes de développement arrêtées et défauts conservés dans L11/native-development-incidents.md ; elles ne comptent pas comme recettes finales.
- Revues indépendantes finales [L11](L11/final-review.md) et [L12](L12/final-review.md) acceptées, sans finding restant : `review-7bd6ebd25d4e4e8ca147f54601a2ce8d` et `review-12e6ebaeac5b434d82936c24733d1bbc`. Les passations et JSON stricts sont conservés dans leurs dossiers.
- Contrôle d'archivage : tous les JSON sont lisibles et les recherches ciblées de secrets n'ont trouvé aucune valeur suspecte. `git diff --cached --check` global signale des espaces/lignes vides dans d'anciens logs et rapports de validation ; ces preuves sont conservées octet pour octet avec leurs empreintes, sans les reformater. Le code produit est inchangé depuis sa qualification ; le lint source et le contrôle d'espaces des nouvelles mémoires/helpers/rapports de remise sont vérifiés séparément.

## Fournisseurs et limites

Claude Code **2.1.304** et Codex CLI **0.163.0** ont réellement participé. `model:null` conserve leurs préférences natives. Les événements normalisés de ces recettes ne nomment pas le modèle effectif ; aucun modèle particulier n'est déclaré qualifié. Les IDs natifs exacts sont conservés en SQLite et dans les rapports filtrés, sans identifiants d'authentification.

Application et transport : chacun 22 tours terminés, zéro incomplet et chevauchement réel Claude/Codex. Document : 6 tours et pic1. Correction finale : 14 tours Codex terminés, zéro incomplet, pic3. Une sortie native0 seule ne vaut jamais approbation. Le quota n'a pas été provoqué ; le signal rate_limit puis le message terminal process sont conservés. La classification des erreurs n'est donc pas présentée comme parfaite.

Le premier run de correction a été annulé après un incident de planification : une passation classait des tests personnels non exécutés dans ses limitations, puis le chef a accepté A/B avant de vérifier la complétude du lot entier. Les gardes ont refusé la dernière livraison. Un diagnostic indépendant et des réponses opérateur ont été nécessaires ; les tâches acceptées étant terminales, le propriétaire a conservé ce run et rejoué le scénario. Le run final a les mêmes tests/règles métier et utilise Codex pendant le quota Claude. Le budget contextuel de la fixture, temporairement augmenté explicitement de24000 à64000 sans retirer d'information obligatoire, a été rétabli à24000 après clôture. Voir L11/correction-planning-incident.json. Aucune garantie de succès autonome universel n'est annoncée.

| Environnement | Statut | Limite |
| --- | --- | --- |
| macOS arm64 / Node26.12.0 | Paquet installé, recettes natives et conservation après réinstallation vérifiées | L11/L12 |
| macOS arm64 / Node24.22.1 | 182 tests source, charge7 et binaire installé (aide/diagnostic/service/état/arrêt) réussis | Objectifs natifs exécutés sous Node26 ; aucun nouveau LLM dans le smoke Node24 |
| Linux | not_verified | Hôte non utilisé |
| Windows via WSL | not_verified | Hôte non utilisé |
| Windows natif | Hors qualification actuelle | Aucun essai natif ; WSL également not_verified |

La cible de portabilité complète reste non atteinte. SQLite est intégré à Node ; aucune extension native tierce à compiler n'a été ajoutée. Les comptes natifs restent nécessaires et soumis à leurs limites.

## Remise et démarrage

Guides : [installation](../../docs/INSTALLATION.md), [utilisation](../../docs/USAGE.md), [reprise](../../docs/RECOVERY.md), [adaptateurs](../../docs/ADAPTERS.md), [changelog](../../CHANGELOG.md).

```sh
npm install --global --prefix "$HOME/.local" /chemin/avity-crew-0.1.0.tgz
export PATH="$HOME/.local/bin:$PATH"
avity-crew --version
cd /chemin/du/projet
avity-crew init
avity-crew doctor --json
avity-crew run "Créer le livrable défini" --chief codex --criterion "Vérifier son comportement par une commande reproductible"
avity-crew status --json
avity-crew
```

Projet nouveau : créer son dossier et initialiser Git pour le mode code avant init, ou utiliser l'option explicite `--init-git`. Document sans Git : `run ... --mode documentation`. Les options de reprise, changement de chef et réponse aux questions figurent dans le guide et `--help`. Pour retrouver un objectif existant, démarrer son service puis utiliser `attach --run ID` ; la commande sans argument recueille une nouvelle demande multiligne.

Avant mise à jour ou désinstallation, arrêter les services concernés et observer leur sortie. `npm uninstall --global --prefix "$HOME/.local" avity-crew` retire le programme ; les données sont conservées. Leur suppression est un geste explicite séparé. Consulter le guide pour la sauvegarde SQLite avec service arrêté.

## Acceptation

Les treize lots L00–L12 sont acceptés. Le paquet local est installé, les recettes finales exigées sont vérifiées et les données ont été conservées après désinstallation/réinstallation. Le lancement par le nom `avity-crew` via le PATH temporaire d'un processus enfant a aussi passé `--version` et `--help` depuis les deux projets avec espaces (L12/path-smoke.json), sans modifier le profil shell.

Les services et serveurs de QA sont arrêtés, leur sortie a été observée ; le programme installé et les projets de recette restent disponibles. Les worktrees gérés de correction/revue ont été archivés avec snapshots récupérables ; aucun travail utilisateur n'a été écrasé.

**Limites de remise :** macOS arm64 qualifié, Linux et Windows/WSL `not_verified`, CI distante non exécutée, sept places simulées contre un pic natif de trois. Les comptes/quotas natifs et une aide opérateur éventuelle restent nécessaires selon le plan produit. Ces écarts ne sont pas présentés comme une qualification générale.

**Production et publication externe : non demandées et non exécutées.**
