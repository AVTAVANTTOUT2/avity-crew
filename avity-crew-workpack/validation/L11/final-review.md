# L11 — Revue indépendante finale

Relecteur : `l00_provider_audit`. Dépôt utilisé explicitement : `/Users/zeldris/avity-crew`. Source figée : `537d3c40f673eb2ca7b0984d695bfed90282e746`. Paquet : `947da88b8cede34df6a50d1e3b5c0fed3db006d001c976ca35b8df20550c47d1`, installé sous `/Users/zeldris/.codex/avity-crew-validation/20261024/install prefix`.

**Décision : accepted, aucun finding bloquant.** Passation exacte : `handoff-a3b4454658bf48ebbfefdf58967b7d76`. Les preuves correctives et de conservation précédemment ouvertes sont maintenant terminées et vérifiées ci-dessous. La passation source537 déclare des contrôles réussis, `live_verification:passed`, limitations et next_steps vides. RELEASE_REPORT.md distingue les recettes réussies des revues formelles encore en cours ; cette décision concerne L11, sans enregistrer l'acceptation de L12 ni modifier la coordination.

## Vérifications indépendantes déjà disponibles

Les contrôles complets `npm run check` sous Node26.12.0 et les **182/182 tests sous Node24.22.1, zéro skip**, ont été exécutés par ce relecteur au même SHA dans la revue L08 immédiatement précédente, et repris explicitement dans L10. Aucune suite large n'est relancée ici. Le SHA du tarball, ses 130 entrées et l'identité des octets du runtime compilé avec le build source ont également été vérifiés. Les anciennes preuves de développement restent séparées.

Cette préparation ajoute les contrôles légers suivants, sans fournisseur ni mutation métier :

- `'/Users/zeldris/.codex/avity-crew-validation/20261024/install prefix/bin/avity-crew' --help` et `--version`, depuis le projet Transport : exit0 ; version0.1.0. Aucune création de service ou de run.
- **38 commandes documentées** de README.md, INSTALLATION.md et USAGE.md passent `parseCli()` du paquet installé. C'est une validation du parsing, pas une exécution de leurs mutations.
- **26 liens locaux** contrôlés dans README/INSTALLATION/USAGE/CLI existent dans le paquet installé ; aucun lien manquant.
- Relecture SQLite/Git réelle de la recette Transport par la commande concrète ci-dessous : exit0 et `NATIVE_RECIPE_OK`.
- Relecture indépendante SQLite/FS/hash du document final : completed/version114, deux tâches accepted, une acceptation et une revue approved à l'empreinte du manifeste, un résultat final, aucun dossier `.git`. Document et manifeste immuables hachés à nouveau ; le manifeste cite bien le chemin et le SHA du document. Six intervalles natifs complets `live`, pic mesuré1, limite1.

```sh
node /Users/zeldris/avity-crew/avity-crew-workpack/validation/L11/assert-native-recipe.mjs /Users/zeldris/.codex/avity-crew-validation/20261024/data/avity-crew/project-4125dcc47d867f92f1d8b61235deef81/state.sqlite '/Users/zeldris/.codex/avity-crew-validation/20261024/native transport fixture' run:858ac152-b0d8-4b3f-8720-7ebec5b0a36e
```

Transport : completed/version430, six tâches accepted, deux acceptations et deux revues finales approved du candidat `git:6be7d7e2d26e5b2aed86b73ad687a3a14a03963f`. HEAD initial conservé, dossier principal propre, contrôles `check:git-diff` et `acceptance` exit0. Les 22 tours natifs sont complets ; Claude et Codex écrivent simultanément de 17:00:43.737Z à 17:01:22.628Z, pic 3 pour limite 3. Les observations navigateur restent attribuées au coordinateur : formulaire français, création brouillon, conflit avec création employeur, deux lignes conservées après rechargement et assertions API indépendantes.

Document : run `run:5ce6a875-cd7e-4760-9fef-20fbb6c92387`, fichier `docs/recette.md`, SHA256 `3c674cb64082b580b2f2619ae24733627c906ea8b5b63e2dab7a7c6c993e99a8`, manifeste accepté `sha256:7a84771b15789d517d002268ebecf8c69e9d75bf73a29e0b7f18369e06a930fc`. Chef Codex, auteur Claude et reviewer Codex distincts ; les observations manuelles ont `command:null`, les comparaisons de hash automatisées sont identifiées comme telles.

## Matrice E2E — état final

| Cas | Preuves actuellement examinées | État |
|---|---|---|
| E2E-01 nouvelle application | new-app-native-report/browser-qa ; relecture SQLite/Git indépendante déjà effectuée : completed378, cinq tâches accepted, deux acceptations du candidat1a82bbfb, comportement navigateur v2 et commande serveur rapportés | Couvert |
| E2E-02 feature existante | Transport isolé, completed430 ; serveur, UI et revues réunis ; preuves HTTP/SQLite et assertions du candidat, conflit employeur/chauffeur observé au navigateur | Couvert, aucune production utilisée |
| E2E-03 chef interchangeable | Application : Claude chef et auteur Codex, puis chef Codex génération2 ; Transport/document : chef Codex et auteur Claude. Même moteur et modèle de données | Couvert |
| E2E-04 correction | Nouveau run Codex f57b56fc completed291 ; isolés0/0, combinaison1 attendue avant décision et tâche corrective, puis combinaison finale0. Helper rejoué indépendamment : six tâches accepted, trois acceptations et trois revues finales du même candidat bb0f5528 | Couvert ; ancien run annulé conservé comme incident |
| E2E-05 contexte actualisé | Décision v2 ciblant l'UI avant sa reprise ; ancienne décision superseded. Prompt/inspection immuables relus et SHA conformes ; comportement v2 observé, tests de ciblage actuels | Couvert ; voir revue L10 |
| E2E-06 reprise et fermeture | Tests CLI/HTTP/processus et native pause UI avant passation, ancien service arrêté, restart, fichiers partiels hachés et préservés ; chef remplacé, nouvelle tentative livrée. Rapport de deux PTY réels du binaire installé : q/détachement/réouverture, état paused inchangé et zéro tour lancé | Couvert avec les limites explicites L10 ; preuve PTY enregistrée distincte des tests simulés |
| E2E-07 sept sessions | final-load-report : sept places scheduler et sept processus locaux simulés, sept workspaces ; zéro CLI LLM, état final paused et aucun achèvement métier forcé. Pic natif réellement observé3 seulement | Couvert au niveau simulé autorisé par ACCEPTANCE.md, jamais présenté comme sept LLM natifs |
| E2E-08 limites/permissions/question | Tests déterministes quota/auth/attente/indépendance. native-permissions sur le paquet947da88 : Claude et Codex, permission refusée, outils MCP listés mais aucun appel refusé exécuté, success=false malgré exit0. Réponses utilisateur reliées aux questions et décisions. Quota Claude survenu naturellement dans l'ancien run, attente et remplacement explicite Codex consignés dans l'incident | Couvert aux niveaux annoncés ; aucun épuisement de quota provoqué |
| E2E-09 intégration cohérente | Nouveau candidat combiné e9163de0 refusé2>1 ; correction limitée à policy.json, A/B restent activés, policy serial/capacity1. Nouveau candidat bb0f5528 contrôlé puis accepté par trois passations et clôture ; HEAD initial conservé | Couvert par relecture et réexécution indépendante des quatre contrôles ciblés |
| E2E-10 installation/deux projets | Paquet autonome installé, contenu SQL/templates/bridge contrôlé. Cycle uninstall/install et smokes installés Node24/26 enregistrés. Comparaison indépendante des snapshots avant/après : identiques, 911 fichiers et sept projets, sources et lignes métier conservées ; zéro nouveau LLM et services arrêtés selon rapport | Couvert ; la répétition de l'installation n'est pas revendiquée par ce relecteur |
| E2E-11 document sans Git | Nouvelle recette entièrement sur537, document et manifeste rehashés ici, deux tâches accepted, revue et clôture sur empreinte, aucune initialisation Git | Couvert sur le paquet final |
| E2E-12 une place | Nouvelle recette documentaire : six tours natifs complets, pic1/limite1 ; tests stricts chef→worker→chef au même SHA | Couvert sur le paquet final |

## Critères AC-L11

- AC-L11-01 : application nouvelle utilisable et contrôlée, couvert par la recette7146 et la preuve navigateur distinguée de la relecture du stockage.
- AC-L11-02 : feature chauffeur et parcours préexistants, couvert par Transport858a, ses critères, contrôles combinés et observation de persistance/conflit.
- AC-L11-03 : équipes natives mixtes réelles, couvert ; les intervalles complets et IDs natifs sont conservés, avec auteurs distincts.
- AC-L11-04 : charge cible mesurée, sept simulés et trois natifs observés explicitement distingués. Les sept enfants locaux ne deviennent pas une preuve de sept comptes LLM.
- AC-L11-05 : transparence cohérente dans les rapports courants, source/paquet cités ; les incidents historiques, refus, essais annotés exclus et limites de plateforme ne sont pas effacés.
- AC-L11-06 : commandes et liens contrôlés ; guides installation/usage/adaptateurs et CI déclarative présents. Le README conserve une formulation prudente de V1 en recette ; RELEASE_REPORT.md porte les preuves finales locales du paquet exact, sans promettre une autre plateforme ni un succès autonome universel.
- AC-L11-07 : les gardes et régressions actuelles empêchent l'acceptation d'un échec ; le nouveau parcours correctif natif fournit maintenant sa clôture et ses trois acceptations sur le candidat contrôlé, après l'échec combiné attendu. L'ancien parcours reste explicitement cancelled et ne compte pas comme réussite.
- AC-L11-08 : nouvelle recette documentaire sans Git terminée et indépendamment vérifiée, couvert.

## Vérifications des dernières preuves et incidents conservés

Le helper correctif a été exécuté ici, exit0 et `NATIVE_CORRECTION_OK`, avec la commande concrète :

```sh
node /Users/zeldris/avity-crew/avity-crew-workpack/validation/L11/assert-native-correction.mjs /Users/zeldris/.codex/avity-crew-validation/20261024/data/avity-crew/project-222b1ea7f3f11a39a579b09ef73a369f/state.sqlite '/Users/zeldris/.codex/avity-crew-validation/20261024/native correction final' run:f57b56fc-ab6a-47af-b1d1-b446174f1d63
```

Résultats rejoués : `200e49c05713312f809128443ea58b7c3ff986e9` isolated0 ; `ffb79d170e7a400a15751fbb48a32353bcd671e9` isolated0 ; `e9163de0da4d7722baa426592d286813c52749cf` combined1 attendu (`2>1`) ; `bb0f552826fa7ee17921ec5dadfdb50f3f472375` combined0, A/B activés et traités avec pic1/capacité1. L'ordre observé est isolés18:07:51/54Z → échec18:07:58.715Z → décision18:08:30.875Z → tâche corrective18:08:41.430Z. Toutes les acceptations surviennent ensuite ; le run completed291 contient six tâches accepted, trois acceptations du même SHA, trois revues courantes,14 tours Codex complets et pic3. Cette recette ne constitue pas une nouvelle disponibilité de Claude ; sa participation réelle est prouvée dans les recettes mixtes antérieures du même paquet.

L'ancien run `run:e8fb4f37-7e29-4112-90c3-4e70fd4daf1d` est directement relu cancelled, aucun final. `correction-planning-incident.json` conserve quota naturel, STALE_REVIEW, problème de passation incomplète et impossibilité de réviser une partie terminale du lot. Aucune ancienne acceptation, preuve ou limitation n'est réécrite. Le nouveau run a imposé la complétude des trois passations avant acceptation ; aucune baisse de critère ni correction produit n'est revendiquée.

L'incident CONTEXT_BUDGET_EXCEEDED est explicitement documenté : arrêt observé du PID86458, augmentation publique temporaire24000→64000 et reprise, sans retrait silencieux de contraintes. La remise à24000 a été vérifiée ici dans `.avity-crew.json` du projet correctif ET dans la configuration persistée SQLite. Les arrêts/redémarrages et sorties PID restent des observations consignées par le coordinateur ; aucun processus n'a été manipulé par ce relecteur.

`lifecycle-before.json` et `lifecycle-after.json` ont été comparés par égalité structurelle complète : **identiques**, sept projets et911 fichiers, empreinte globale `983503595db331fe444a9782198018631f81c9a7a86d96d3e26d3b6836939b58`. Les snapshots couvrent sources, runs, tâches, enregistrements durables et empreintes des lignes métier. Le rapport associe uninstall0/install0 aux smokes installés Node24/26 sur projets distincts et chemins avec espaces ; zéro nouveau tour LLM, zéro service restant. Le SHA du tarball a été recalculé ici après réinstallation et reste947da88b. Ce contrôle ne prétend pas avoir personnellement observé la désinstallation ni rejoué ses mutations.

Le rapport PTY installé est également relu : deux ouvertures/détachements via q, état paused/version4 inchangé, tâche et décision conservées, zéro actif/en file ; annulation du prompt vide par Ctrl-C sans objectif soumis. C'est une preuve terminal enregistrée, distincte du navigateur et des tests automatiques. Les diagnostics SUPERVISOR_UNAVAILABLE/NOT_FOUND ne sont pas transformés en succès métier.

La passation réelle et RELEASE_REPORT.md actualisé sont cohérents avec ces résultats. Aucun finding bloquant ne subsiste dans L11. La validation conserve les limites d'environnement et la nécessité possible d'une intervention opérateur lorsqu'un plan natif ne progresse plus.

## CI et limites

`.github/workflows/check.yml` prévoit npm ci, génération/types/formatage/build/tests via check, puis npm pack sur Node24.22.1 et26.12.0. Aucun compte fournisseur ni appel live n'est ajouté aux jobs ordinaires. **CI distante NON EXÉCUTÉE** et Linux/Windows/WSL non qualifiés ; la qualification observée reste locale macOS arm64. Les essais intensifs de quota/auth/réseau réels ne sont pas revendiqués.

La revue reste à indépendance répartie : les auteurs de modules ne sont pas présentés comme leurs propres relecteurs indépendants. Les résultats et traces du coordinateur sont distingués des contrôles rejoués par cette session. Aucun provider, agent, service, DB ou état de coordination n'a été modifié ; seuls ce rapport et son JSON formel sont écrits. Aucun sous-agent et aucune ancienne worktree n'ont été utilisés.
