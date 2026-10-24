# L10 — Revue finale de la reprise et de la résilience

Relecteur : `l00_provider_audit`. Source et candidat moteur examinés : `537d3c40f673eb2ca7b0984d695bfed90282e746`. Passation : `handoff-a9aa5042673e4a3e9b7aa341c87773cd`. **Décision : accepted, aucun finding bloquant.** La passation finale a été relue : révision conforme, contrôles réussis, limitations et next_steps vides ; ses limites documentées correspondent à cette revue.

## Contrôles source et portée de l'indépendance

Les contrôles suivants viennent d'être exécutés par ce relecteur à la même source, pendant la revue L08 immédiatement précédente ; aucun changement suivi n'est intervenu. Leur répétition n'apporterait pas de preuve supplémentaire :

- Depuis `/Users/zeldris/avity-crew`, `npm run check` : exit0 sous Node26.12.0, génération, typage, Prettier, build et suite réussis.
- Même dossier, `npm exec --yes --package=node@24.22.1 -- node --test --test-reporter=tap 'dist/tests/**/*.test.js'` : exit0, **182/182**, zéro skip, échec ou annulation.
- La commande SQLite/Git concrète ci-dessous : exit0 et `NATIVE_RECIPE_OK`.

```sh
node /Users/zeldris/avity-crew/avity-crew-workpack/validation/L11/assert-native-recipe.mjs /Users/zeldris/.codex/avity-crew-validation/20261024/data/avity-crew/project-1a121d7e95c2fc3d1965e22469d3c29b/state.sqlite '/Users/zeldris/.codex/avity-crew-validation/20261024/native new app final' run:71469044-5ca6-473e-8e78-de2f4ad719e6
```

Le tarball conservé a été haché indépendamment : `947da88b8cede34df6a50d1e3b5c0fed3db006d001c976ca35b8df20550c47d1`, 130 entrées, runtime compilé identique au build de cette source. La revue L10 porte sur les raccordements de fiabilité du coordinateur et les traces conservées. Elle s'appuie sur les revues indépendantes réparties antérieures pour les modules écrits par ce relecteur ; elle ne se présente pas comme une nouvelle revue indépendante de ses propres modules CLI/transport/contexte.

## Critères d'acceptation

| Critère | Preuves et résultat |
|---|---|
| AC-L10-01 — Reconnexion | Tests CLI/client/HTTP de détachement sans arrêt du service et reprise par curseur ; reconstruction du runtime depuis SQLite. La recette native récente comporte une pause, un arrêt du service observé puis un redémarrage, en conservant le même objectif et ses tâches. Fermer une vue n'est pas assimilé à un arrêt de fournisseur. |
| AC-L10-02 — Coupure | Ancienne tentative UI `attempt:11edf3c1-1c4c-430f-9e2c-80b08421ad07` conservée `interrupted` avant passation. Les deux fichiers partiels de son workspace ont été relus ici et correspondent exactement aux hashes rapportés. La nouvelle tentative `attempt:b7a7c148-be7d-4c93-896a-d194f62c798a` est distincte, génération3, `exited`/exit0. Tests Git réels des coupures, capture cumulative et réconciliation. |
| AC-L10-03 — Déduplication | Suite actuelle : rejeu d'une réponse HTTP perdue avec même clé, transactions et observations idempotentes ; promotion Git appliquée par CAS, reprise après promotion dont le résultat DB n'était pas encore enregistré ; candidat conservé après arrêt d'un writer d'intégration. Le run natif contient un seul résultat final et les deux acceptations courantes visent le même candidat vérifié. |
| AC-L10-04 — Remplacement | Tests des anciennes générations/tentatives/passations refusées, révocation pendant file/préparation/promotion et amendements de base/scope. Ancien writer observé arrêté avant réattribution. La recette native conserve l'ancienne tentative interrompue et accepte une nouvelle livraison courante, sans réécrire l'ancienne. Aucune réponse tardive native n'a été artificiellement injectée pendant cette revue : ce cas est déterministe. |
| AC-L10-05 — Nouveau chef | Dans le même run natif entièrement sur 537 : Claude initial, Codex final, génération2 ; décisions, tâches et objectif conservés. Le remplacement est enregistré à 16:14:28.962Z. Les tests vérifient en plus la révocation et l'absence de tâche DAG fictive pour le chef. La mémoire interne d'un fournisseur n'est pas présentée comme transférée. |
| AC-L10-06 — Limite fournisseur | Les erreurs normalisées, auth/quota/permission, conduisent à une attente visible ou une reprise explicitement choisie ; aucun exit fournisseur ne suffit à accepter un résultat métier. Le refus Bash natif de l'auteur Claude est conservé dans la recette récente. Auth/quota et indisponibilité de reprise restent simulés : aucun épuisement réel de quota ni secret d'authentification n'a été provoqué pour cette revue. |
| AC-L10-07 — Contexte | Contexte UI de reprise `context:bea7c12a5c1f36a009773162252f40ab`, enregistré à 16:14:30.410Z, contient la décision v2 approuvée à 16:14:28.008Z ; il remplace le contexte initial lié à la décision superseded. Prompt exact de 36 021octets et inspection de 1 982octets relus depuis leurs artefacts immuables : deux SHA conformes, décision v2 présente dans les deux. Le comportement v2 est observé dans la preuve navigateur consignée ; les octets UI du candidat testé correspondent au candidat accepté. Tests d'inspection en run long et de sources requises complètent cette preuve. |

## Vérifications indépendantes de la récupération native

L'ancien workspace `operation:0096851c-33f8-470e-807b-77ec40bb24fb` existe encore. Les empreintes recalculées de `public/index.html` et `README.md` correspondent respectivement à `7e472cfe71bf1fd48f0821e6f563eb0f146d74496ef3d234788e1d1cbf981883` et `d8a54a1c6f2c526b46d4b5baed9fd7679af94fb2e6166a0e6e6dd1e1bdc50a08`. Cette relecture actuelle confirme leur conservation ; l'observation exacte juste après redémarrage reste attribuée au rapport du coordinateur.

Le nouveau workspace `operation:fe81dfaf-d160-42d6-a5e4-2bf57c3c3403` reprend depuis un snapshot partiel distinct. La base courante de la TaskSpec reste celle qui définit la livraison cumulative : ce point est couvert par les tests et les probes Git indépendants consignés dans `recovery-delivery-review.md`. Une base amendée incompatible refuse la collecte avec BASE_CHANGED, et le périmètre est contrôlé sur tout le cumul.

Les références du contexte de reprise sont `artifacts/2e70e2a08f84d0126ed0ab99a85dc237d42f9918c055a4925a998b62bc0565d2` pour le prompt et `artifacts/6fc9d6bb0bd84c3035be3ee0d93801a32f81fbd541b43880fbd39c0d3088d512` pour l'inspection. Leur contenu n'est pas recopié dans ce rapport. La décision ciblée précède ce dossier et la reprise attestée ; il ne s'agit pas d'une correction ajoutée après la livraison.

La relecture de la recette retrouve completed/version378, cinq tâches acceptées, deux acceptations et les revues finales approved sur `git:1a82bbfb58223460449bffa2ca3cf257e4f30879`. Les 22 tours natifs sont complets, sans Fake. Le chevauchement des auteurs mixtes est réel et distinct de l'échantillon OS à trois processus. La réponse technique MISSING_EVIDENCE sélectionne des logs existants déjà retenus pour les bons critères ; les critères et les protections restent inchangés.

## Boucles et limites explicites

`recovery-preparation-review.md` a démontré avant/après que BASE_CHANGED ne laisse plus une délégation queued relancée indéfiniment : après claim, le catch marque une préparation exited sans PID, bloque seulement la tâche et libère la place pour une tâche indépendante. Entre ce correctif et la source 537, seuls des tests runtime ont été ajoutés. La nouvelle régression actuelle vérifie aussi qu'une nouvelle délégation explicite est nécessaire avant un nouvel essai.

La conservation d'un snapshot incertain ne promet pas l'import automatique de son contenu. BASE_CHANGED et les processus à identité ambiguë exigent une décision explicite ; la prudence n'est pas transformée en succès. L'ancien run 49d reste conservé comme incident, et la nouvelle recette 7146 porte seule la preuve native récente. Les tests simulés ne deviennent pas des essais natifs par leur intitulé.

Aucun fournisseur, produit, état de coordination, nettoyage de workspace ou processus étranger n'a été lancé/modifié par cette revue. La nouvelle recette documentaire max1 annoncée completed par le coordinateur n'est pas utilisée ici : son rapport final n'a pas été examiné dans ce périmètre. Qualification locale macOS arm64 ; CI distante, Linux/WSL et Windows non exécutés. Ces limites de plateforme ne sont pas présentées comme du travail L10 manquant.

