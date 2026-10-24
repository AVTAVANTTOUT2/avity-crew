# L03 — Contexte, prompts et reprise

Auteur : `l03-context` (agent `/root/l00_provider_audit`). Branche `build/l03-context`, worktree `/Users/zeldris/.codex/worktrees/avity-crew-l03`. Base L02 acceptée : `cff8ef66ad33bf0e103e9192d868baabcd7a220d`. Source livrée et contrôlée : `6559d41750fc139081916d9e0840235e248a9baa`. Le worktree était propre après les contrôles finaux.

## Résultat et fichiers

Le module produit `packages/context/src/index.ts` expose compilation pure, inspection du prompt exact, mises à jour ciblées et reprise. `project.ts` reconnaît le projet, lit les sources actuelles et réconcilie leurs versions ; `templates.ts` contient les règles d'équipe et de rôles versionnées `avity-context:1`, adaptées des spécifications du pack sans dépendance runtime à ce dossier.

Autres fichiers : `docs/CONTEXT.md`, `tests/context.test.ts` et cinq fichiers de fixture dans `tests/fixtures/context/project/`. Aucun contrat, manifest partagé, export racine, lockfile, changelog ni autre module n'a été modifié. Aucune dépendance ajoutée. Les données de test du sous-dossier fixture ne sont pas un produit client.

Le port de lecture `ContextReadPort` est constitué des vues durables `run`, `decisions`, `messages` ; L07 fournit ces vues et conserve la responsabilité des écritures, droits et transmissions. La compilation n'accède pas à SQLite et n'invoque aucun CLI fournisseur.

## Vérifications réellement exécutées

| Commande | Environnement / portée | Résultat |
|---|---|---|
| `npm ci` | Node 26.12.0, npm 11.20.0, worktree dédié | code 0 ; aucune vulnérabilité signalée par npm |
| `npm run check` | HEAD `6559d41750fc139081916d9e0840235e248a9baa`, macOS arm64 / Node 26.12.0 | code 0 ; typage, Prettier, build et 51 tests réussis, dont 8 tests L03 |
| `npm exec --yes --package=node@24.22.1 -- node --test dist/tests/context.test.js` | même HEAD / Node 24.22.1 | code 0 ; 8 tests réussis |
| `git diff --check cff8ef66ad33bf0e103e9192d868baabcd7a220d..HEAD` | diff de livraison | code 0 |

Ces tests utilisent de vrais fichiers jetables et Git pour la reconnaissance/exclusion, mais le fournisseur `FakeProvider` est explicitement **simulé**. Aucun échange Claude/Codex réel n'a été lancé par L03 ; aucune recette live produit n'est revendiquée.

Le test de transport capture `ProviderRequest.prompt`, vérifie qu'il est identique à l'inspection et à la chaîne hashée par `bundle.content_sha256`, puis exécute le vrai `FakeProvider`. Le paquet sérialisé/désérialisé conserve ces octets. Le paquet d'exemple dans `context-example.json` a été effectivement compilé depuis la fixture dans un dossier temporaire avec espaces et transmis au fournisseur fake ; les empreintes de prompt concordent. Le dossier jetable a été supprimé ensuite.

## Critères de la fiche L03

| Critère | Preuve |
|---|---|
| AC-L03-01 — Pertinence | Deux missions billing/web reçoivent leurs fichiers propres, la règle racine commune et seulement les instructions de sous-dossier applicables ; les références non pertinentes sont inventoriées comme exclues. |
| AC-L03-02 — Actualisation | Un contrat passe de V1 à V2, reçoit un nouvel ID immuable et un hash courant ; l'ancien reste consultable. Une référence supprimée est signalée, les tâches affectées sont identifiées et une référence requise disparue bloque. Une décision V2 remplace la décision approuvée V1. |
| AC-L03-03 — Provenance | Sources versionnées/datées, identité/tentative/génération et révision observée ; version de template et empreinte du TaskSpec ; rendu inspecté égal au prompt fourni au fake, altération refusée. |
| AC-L03-04 — Reprise | Nouvelle tentative et génération reçoivent objectif, contraintes, critères, décision approuvée, Git, tâche interrompue, blocage, preuve et prochaine action ; un paquet d'un autre run est refusé. |
| AC-L03-05 — Contraintes | Un gros extrait secondaire est omis avec référence et raison ; critères, restrictions, instructions et décisions restent présents. Un budget inférieur au noyau obligatoire échoue explicitement, sans tronquer. |
| AC-L03-06 — Contenu externe | Une note qui prétend désactiver les autorisations reste une donnée ciblée ; une proposition ne devient pas une décision approuvée. Les permissions du brief restent celles fournies par le superviseur. Doublons exacts dédupliqués, contenu contradictoire sous même ID refusé. |

Autres frontières éprouvées : `.env`, dépendances et fichier Git ignoré exclus avant ingestion ; secret reconnu expurgé ; valeur sensible structurée masquée ; binaire et lien externe exclus ; alias interne avec espaces conservé ; traversée `..` refusée ; variable non résolue et manque d'artefacts/de dépendance/de plan de validation signalés ; dossier nouveau sans Git et dépôt Git non commité distingués.

## Décisions d'intégration et limites documentées

- Les sources sont immuables : ID = empreinte du projet, chemin et contenu ; `revision` = SHA-256 des octets originaux. La sélection accepte les anciens SourceRef pour relire leur chemin et explicite le remplacement, sans réécrire l'historique.
- `bundle.layers` contient les règles, le rôle, le brief et les updates. Aucun rôle ne rend récursivement son propre bundle. Le prompt est assemblé une seule fois ; un adaptateur reçoit cette chaîne sans nouveau rendu.
- Le superviseur persiste le bundle, les nouvelles sources et l'inspection complète comme artefact. Le prompt résume les exclusions par raison/nombre, et l'inspection conserve les chemins. Cette documentation d'interface ne signifie pas que L07 est déjà livré.
- L'estimation octets UTF-8/3 est annoncée comme heuristique, avec réserve configurable pour réponse/outils/instructions natives. Elle n'est ni une mesure provider ni une garantie universelle de tokenizer.
- Le scanner est lexical et borné ; une limite d'inventaire ou de fichier est explicite. Sans Git, seules les exclusions intégrées et de tâche s'appliquent ; dans Git, check-ignore applique aussi les exclusions du dépôt. Les commandes hors npm restent des références à examiner.
- Les secrets de forme connue sont masqués, mais la détection de toute chaîne secrète arbitraire n'est pas garantie. L'exclusion des fichiers d'identifiants et la sélection ciblée restent prioritaires. Le module ne donne jamais d'autorité à une note ; les ACL réelles restent contrôlées par le moteur.

NON EXÉCUTÉ : fournisseurs réels dans ce lot pur, recette complète de la boucle L07/L08/L11, plateformes Linux/Windows. Ces périmètres ne sont pas revendiqués par cette livraison. La revue indépendante et la vérification de la combinaison sont à effectuer par le coordinateur, sans être présentées comme rejouées ici.
