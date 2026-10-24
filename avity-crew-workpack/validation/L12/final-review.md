# Revue indépendante finale L12

**Conclusion : accepted, aucun finding restant établi pour L12.** Passation exacte : **`handoff-d898032f48804dfca401a49b9cc519e3`**, `validation/L12/final-handoff.json`. Relecteur : `/root/l05_codex`. Source, révision testée et candidat : **`git:537d3c40f673eb2ca7b0984d695bfed90282e746`**, vérifiée dans `/Users/zeldris/avity-crew` ; base d'intégration **`git:f0d0d077e1ed5464f9dc6e476403e6e349c39bf7`**, confirmée ancêtre du candidat. Après le signal de fin de lifecycle de la racine, seuls des contrôles en lecture seule ont été exécutés : aucun produit, registre de coordination, préfixe installé, service ou base n'a été modifié. Aucun binaire installé ni fournisseur n'a été lancé par ce relecteur. Le statut formel reste à enregistrer par le coordinateur.

## Paquet examiné indépendamment

Archive : `/Users/zeldris/.codex/avity-crew-validation/20261024/release-final/avity-crew-0.1.0.tgz`.

SHA256 recalculé : **`947da88b8cede34df6a50d1e3b5c0fed3db006d001c976ca35b8df20550c47d1`**. **130 fichiers**, concordant avec `package-content.json` et `package-installation.json` lus. L'archive a été listée avec `tar -tzf` / `tar -tvzf`, puis chacun de ses fichiers lu en mémoire avec `tar -xOf`, sans extraction sur disque ni exécution d'un script du paquet.

- Tous les chemins restent sous `package/`, sans traversée `..`, chemin absolu, antislash, doublon, lien symbolique ou autre type d'entrée inattendu.
- Aucun workpack, test compilé, node_modules, dépôt Git, mémoire d'outil, configuration locale, clé, endpoint, base SQLite ou journal de service n'est distribué. Les 75 fichiers de tests compilés repérés lors de l'ancien dry-run documentaire sont bien absents de ce paquet final.
- Aucun chemin de développement `/Users/...`, `/home/...`, URI fichier absolue ou chemin Windows utilisateur n'a été trouvé dans le contenu. Les sourcemaps utilisent des références relatives ; elles ne constituent pas une dépendance du runtime à un checkout de développement.
- Aucun indicateur à haute confiance de clé privée PEM/OpenSSH, clé OpenAI ou clé d'accès AWS n'a été trouvé. Cette recherche ciblée et la revue de contenu ne prétendent pas être une détection exhaustive de tout secret possible.

## Autonomie du runtime

Le manifeste versionne `0.1.0`, déclare ESM, Node `>=24.15.0`, le bin `bin/avity-crew.mjs` et les exports compilés. Le bin importe relativement `dist/apps/cli/src/main.js`. Aucun import runtime relatif manquant n'a été trouvé sur l'ensemble des `.js`/`.mjs`. Les imports externes se limitent aux modules Node et aux deux dépendances déclarées avec versions exactes : `ajv@8.20.0`, `ajv-formats@3.0.1`. Ces dépendances sont installées par npm ; le tarball n'est pas présenté comme une archive sans dépendance réseau ou un binaire autonome sans Node.

CLI, superviseur, pont MCP, adaptateurs et leurs modules sont présents. Les templates de contexte sont compilés dans `templates.js`, les migrations SQL intégrées dans le module Store, les schémas JSON canoniques et leurs représentations compilées inclus. Le runtime n'a pas besoin du générateur TypeScript, d'un `.sql` ou du workpack après installation. Les scripts de développement du manifeste restent destinés au checkout source, sans hook d'installation qui reconstruirait le produit depuis des sources absentes.

Le bin dans l'archive est de mode 0644. Le contrôle indépendant du préfixe réinstallé confirme que le lien `bin/avity-crew` est symbolique, pointe vers le bin du paquet et que sa cible est exécutable. Les **130 fichiers installés** ont été comparés en mémoire aux entrées du tarball : **zéro différence**, tous réguliers. Le mécanisme bin de npm fournit donc l'accès exécutable attendu. Aucun lancement du binaire installé n'a été effectué ici.

## Documentation et fidélité

README, CHANGELOG, guide d'installation, usage, reprise, guide d'adaptateur et exemple ont été relus dans le tarball. Tous les liens Markdown locaux distribués se résolvent dans l'archive. Manifeste, bin, schémas et documents distribués sont identiques octet par octet aux fichiers de la source figée.

Les guides décrivent l'installation depuis un tarball local, Node et les CLI natives nécessaires, la configuration relue au redémarrage, la sauvegarde, l'arrêt avant mise à jour, le risque de retour de version de base, la désinstallation du programme sans suppression des données et l'exemple documentaire. Ils ne revendiquent ni publication de registre ni garantie Windows équivalente à POSIX. Le README conserve le statut prudent de candidat en recette ; le rapport final doit accompagner explicitement la livraison du tarball et qualifier son empreinte exacte.

Le point préliminaire de fidélité WSL est **résolu** : `validation/RELEASE_REPORT.md` ne prétend plus fournir une procédure WSL et conserve cette plateforme `not_verified`. La cible complète de portabilité n'est pas annoncée atteinte. La correction concerne le rapport de livraison ; le produit et l'empreinte du paquet sont inchangés.

## Cycle réel et vérification indépendante de conservation

Les versions actualisées de `lifecycle-report.json` et `package-installation.json` ont été examinées après le signal de fin de cycle. La racine a arrêté et observé les anciens services, désinstallé le programme (exit 0, sept packages retirés, bin absent), puis réinstallé **le même tarball** (exit 0, sept packages ajoutés). Elle a exécuté help/version/service start/doctor/status/service stop sous Node 26 sur deux projets distincts avec espaces, puis sous Node 24 sur le projet documentaire, sans nouveau tour LLM. Tous les codes sont zéro et aucun service possédé ne reste actif selon cette observation. Ces commandes ont été exécutées par la racine, pas rejouées par le relecteur pour éviter toute mutation de l'état.

Contrôle indépendant : lecture du script `snapshot-package-state.mjs`, puis exécution de
`node /Users/zeldris/avity-crew/avity-crew-workpack/validation/L12/snapshot-package-state.mjs /Users/zeldris/.codex/avity-crew-validation/20261024`, Node 26.12.0, **exit 0**. Ce script ne fait que lire les fichiers et ouvrir SQLite avec `readOnly: true` ; il trie les chemins, conserve empreinte de contenu/cible de lien et empreintes des lignes métier sélectionnées. Son résultat actuel est **strictement égal** aux deux JSON `lifecycle-before.json` et `lifecycle-after.json` :

- **911 fichiers d'état / 7 projets** ; empreinte de l'arbre complet **`983503595db331fe444a9782198018631f81c9a7a86d96d3e26d3b6836939b58`**.
- Pour chacun des sept projets, mêmes sources de travail (hors `.git` dans cette empreinte de source), mêmes runs/statuts, tâches et empreinte des lignes métier. L'arbre complet de données inclut, lui, les fichiers Git internes.
- Les empreintes de la base et des fichiers privés restent donc identiques au point d'avant désinstallation, y compris après les smoke checks. Aucun nouveau service n'a été ouvert pour cette vérification.

La conservation des deux anciens runs de test `paused`, de leurs tâches/décisions/critères, est également rapportée par `package-state.mjs check` exit 0. Il s'agit d'une mise à jour depuis des paquets de développement antérieurs du même numéro prerelease, explicitement identifiés ; aucune précédente version publique ni migration de schéma nouvelle n'est inventée. Le paquet reste installé et disponible.

Le rapport final actualisé associe maintenant la recette corrective native terminée (`completed`, version 291) à sa preuve propre ; l'ancien run annulé reste un incident documenté. Les empreintes moteur/paquet restent celles examinées ici. Cette recette est distincte du contrôle de conservation L12.

## Relecture des observations natives du paquet installé

L11 est accepté par `review-7bd6ebd25d4e4e8ca147f54601a2ce8d` selon le signal du coordinateur. Les trois empreintes d'artefacts de la passation L12 (`package-content`, `package-installation`, `lifecycle-report`) ont été recalculées : elles correspondent toutes aux valeurs soumises. La passation annonce `live_verification: passed`, sans limitation bloquante ni étape restante ; ses écarts de plateformes restent dans `documented_limits`.

Deux commandes `assert-native-recipe.mjs` ont été réexécutées **en lecture seule** sur les traces réellement enregistrées du paquet installé, **sans nouvel appel modèle** :

- Preuve Claude dans la nouvelle application, `run:71469044-5ca6-473e-8e78-de2f4ad719e6` : exit **0**, `NATIVE_RECIPE_OK`, état completed version **378**, **5 tâches acceptées**, **2 acceptations**. Les observations natives contiennent Claude et Codex, pic 3, zéro tour incomplet ; racine propre et HEAD initial préservé.
- Preuve Codex dans la fixture transport, `run:858ac152-b0d8-4b3f-8720-7ebec5b0a36e` : exit **0**, `NATIVE_RECIPE_OK`, état completed version **430**, **6 tâches acceptées**, **2 acceptations**. Les observations natives contiennent Claude et Codex, pic 3, zéro tour incomplet ; racine propre et HEAD initial préservé.

Les rapports `new-app-native-report.json` et `transport-native-report.json` identifient tous deux la source moteur `537d3c4` et le tarball `947da88b…`. Ils conservent les versions réelles Claude 2.1.304 / Codex 0.163.0 et l'origine `live` des sessions ; les révisions applicatives acceptées sont distinctes de celle du moteur. Les checks `kind: live` du JSON de revue qualifient cette **relecture d'observations natives réelles déjà enregistrées**, pas l'exécution d'une nouvelle session par le relecteur.

Les 182 tests Node 24/26 ont déjà leurs preuves examinées ; ils n'ont pas été relancés ici. Les recettes natives et la revue L09 sur le même candidat sont des preuves distinctes du contenu du paquet. Aucun nouveau fournisseur ou agent lancé. **Linux/WSL et CI distante : NON EXÉCUTÉS**, conservés dans la décision et le rapport de livraison. La cible complète de portabilité n'est pas présentée comme atteinte : AC-L12-04 accepte ici les écarts explicitement non validés. Les autres critères L12 sont rapprochés du contenu, de l'installation réelle, des projets distincts, de la conservation et de la livraison locale sans publication. Aucun finding restant établi sur ce périmètre ; aucun état de coordination modifié par cette revue.
