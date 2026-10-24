# L00 — Carte des obligations et de la recette

Date : 2026-10-24. Auteur : session `l00_acceptance_map`, sous-tâche du coordinateur L00.

Cette carte résume les exigences du workpack ; elle ne constate aucune acceptation de lot ni aucun essai du produit. Les critères originaux de `lots/` et `docs/ACCEPTANCE.md` restent applicables dans leur totalité. La matrice `docs/TRACEABILITY.md` relie R01–R16 à ces critères. Le protocole de contexte présent dans ce pack est `docs/CONTEXT.md` ; il n'existe pas de fichier `docs/CONTEXT_PROTOCOL.md` dans l'inventaire observé.

## Faits et périmètre

- Le produit à construire est Avity Crew, une application locale de terminal ; Avity Transport est une fixture de recette, sans intervention sur une production.
- L'outil Python de `scripts/coordination.py` organise le chantier. Le produit doit avoir son propre stockage, superviseur, bridge, coordination et sessions.
- La V1 exige Claude Code et Codex réels, tous deux utilisables comme chef ou exécutant, avec leur authentification native. Un provider simulé ne satisfait pas une preuve live.
- Le chef est configurable ; le modèle de cette session de construction n'impose aucun moteur au produit.
- L'utilisateur autorise la construction, les essais locaux et un paquet installable local. Publication externe et production restent hors mandat.
- Les extensions Cursor, interface web et exécution distribuée ne sont pas nécessaires à la V1. Leur report ne permet pas de reporter une obligation V1.

## Lots, dépendances et minimum complet

| Lot | Dépendances | Résultat et preuves obligatoires |
|---|---|---|
| L00 | Aucune | Racine et état initial explicites, préservation, inventaire, versions locales et documentation officielle, capacités/limites sans secrets, décisions de pile et conventions utilisables par L01. Livrer `validation/L00/audit.md` et `compatibility.json`. Couverture AC-L00-01 à 05. |
| L01 | L00 accepté | Workspace strict compilable, lockfile, contrats communs, transitions, adaptateur indépendant, validation des frontières, simulation explicitement identifiée et CI sans compte fournisseur. Install propre, types, build et contrats vérifiés. AC-L01-01 à 05. |
| L02 | L01 accepté | SQLite et migrations, mutations/événements atomiques, idempotence, tentative/génération, provenance et état des messages, projections consultables, sauvegarde et reprise. Vérifier réclamation concurrente unique, rejeu sans effet double, ancien propriétaire refusé, redémarrage, migration et traçabilité. AC-L02-01 à 06. |
| L03 | L02 accepté | Carte sourcée du projet, sélection pertinente sous budget, quatre couches de prompt, bundle réellement envoyé inspectable, invalidation ciblée et dossier de reprise. Deux briefs distincts, changement de contrat, reprise, contraintes jamais omises silencieusement, note sans pouvoir d'élévation. AC-L03-01 à 06. |
| L04 | L01 accepté | Adaptateur Claude : probe documenté/local, événements structurés et fragmentation, identité, reprise explicite, interruption/arbre de processus, permissions et erreurs distinctes. Travail réel, reprise du bon identifiant et appel réel d'un bridge MCP minimal dès ce lot. AC-L04-01 à 05. |
| L05 | L01 accepté | Adaptateur Codex : même contrat commun, transport documenté et handshake si App Server, événements robustes, sessions concurrentes isolées, reprise ciblée et arrêt récupérable. Travail réel et appel réel d'un bridge MCP minimal dès ce lot. AC-L05-01 à 05. |
| L06 | L02 accepté | Worktree/branche par tâche de code, mode lecture/document sans Git, ressources distinctes, livraisons immuables, intégration à écrivain unique, candidat combiné exact et conflit conservé. Préserver dépôts sales et travaux arrêtés ; répéter l'intégration sans doublon. AC-L06-01 à 06. |
| L07 | L03, L04, L05, L06 acceptés | Service unique indépendant de la TUI, canal local protégé, identité dérivée de l'authentification, droits par rôle/projet/tentative, outils complets via MCP et repli CLI testé, état/processus observable et événements paginés. Vérifier deux clients, routage, refus hors rôle et équipe mixte. AC-L07-01 à 06. |
| L08 | L07 accepté | Objectif conservé, graphe valide, contrats avant délégation, délégation non bloquante, exploitation des retours, revue indépendante, intégration/acceptation contrôlées et clôture fondée sur preuves. Chef interchangeable ; deux exécutants mixtes réellement parallèles ; correction après revue ; capacité une place sans interblocage ; document sans Git accepté sans faux candidat. AC-L08-01 à 07. |
| L09 | L08 accepté | Binaire `avity-crew`, aide/doctor, détection cwd, création/reprise/configuration, conversation, questions rattachées, vues tâches/contexte/décisions/notes/diff/preuves, pause/interruption/message/changement de chef, JSON et codes stables. Tester petit terminal, redimensionnement, multiligne, Unicode et événements pendant saisie. AC-L09-01 à 06. |
| L10 | L09 accepté | Reconnexion et réconciliation avant répétition, reprises transitoires bornées, quota/auth visibles, remplacement d'exécutant avec révocation de l'ancien, changement de chef conservant le graphe, dossier de nouvelle session et détection des boucles sans progrès. Tester conservation, déduplication et rejet des retours tardifs. AC-L10-01 à 07. |
| L11 | L10 accepté | Recette complète nouveau projet + feature de fixture existante + défaut/correction + contexte actualisé + incidents + deux chefs + document sans Git. Équipe réelle Claude/Codex et capacité jusqu'à sept chef compris ; limites observées distinctes de la simulation. Documentation conforme à la révision, régression réellement bloquante. AC-L11-01 à 08. |
| L12 | L11 accepté | `npm pack`, inspection du contenu, installation dans préfixe propre, binaire installé depuis deux projets dont un chemin avec espaces, migration depuis version de test antérieure, désinstallation conservant les projets, documentation/changelog/rapport cohérents. Matrice OS et limites explicites ; aucune publication implicite. AC-L12-01 à 07. |

Après L01, L02/L04/L05 peuvent avancer en parallèle. Après L02, L03/L06 peuvent avancer en parallèle. Une préparation indépendante avant acceptation est possible ; elle ne satisfait pas une dépendance. L07 attend ses quatre briques ; L08 à L12 sont ensuite séquentiels.

## Contrats à figer en L01

Ces décisions d'implémentation sont à prendre par le coordinateur ; les comportements décrits sont exigés.

1. **Modèles liés par identifiants** : projet, run/objectif, tâche, tentative, session, décision, contexte, message, livraison, preuve, workspace, événement. Prévoir version de schéma et erreurs explicites. Une tâche livrée diffère d'une tâche acceptée ; un processus sorti 0 diffère d'un travail accepté ; l'identité de contrôle du chef n'est pas une livraison à attendre pour clore.
2. **États et mutations** : autorité unique du service, transitions contrôlées, operation ID pour rejeu, génération/jeton de tentative, événement atomique, décision proposée/adoptée et preuve observée distinctes. Messages enregistrés/livrés/pris en compte/échec sans lecture supposée.
3. **Provider port** : probe/capacités, start, reprise ciblée, envoi immédiat ou différé explicite, interruption/stop et flux normalisé. Capacités documentées `native_resume`, `structured_events`, `mid_turn_input`, `permission_requests`, `usage_reporting`, `mcp_tools` ; absence explicite si non disponible. Séparer tour terminé, processus terminé et mission livrée.
4. **ContextBundle** : identité projet/run/tâche/tentative, objectif/contraintes/critères, décisions versionnées, références sourcées/empreintes, dépendances, périmètre/workspace/base, vérifications, livraison et prochaine action. Quatre couches équipe/rôle/mission/mise à jour. Budget sans disparition des obligations, provenance du paquet effectivement envoyé, invalidation et reprise.
5. **Autorité et transport** : MCP stdio et repli CLI vers le même service, identité issue du canal protégé, validation hors rôle/projet/tentative, aucun pouvoir obtenu via texte libre. Capacités locales hors prompts ; données externes et notes sont des sources, pas des permissions.
6. **Outils chef** : `inspect_project`, `create_task`, `delegate_task`, `get_status`, `send_message`, `collect_delivery`, `record_decision`, `submit_review`, `request_user_input`, `propose_integration`, `accept_delivery`, `finish_run`. Exécutants : `read_context`, `publish_note`, `report_blocker`, `submit_handoff`. Relecteur : revue de la livraison attribuée, avec `approved`, `changes_requested`, `blocked`, y compris refus avant candidat.
7. **Livraison et preuve** : base/source/candidat Git immuables pour code ; `base_revision: null` et empreinte pour document sans Git. Revue indépendante de la version exacte et vérifications adaptées. Une observation manuelle peut avoir `command: null`, accompagnée d'une preuve ; rien ne doit forcer un faux commit.
8. **Intégration et ressources** : candidat combiné, validation de ce candidat, cible avancée seulement avec base attendue, conflit conservé, idempotence et un seul écrivain. Ports/bases/temporaires exclusifs ou distincts ; ces réservations ne sont pas un sandbox de sécurité.
9. **Ordonnancement** : `delegate_task` retourne sans attendre l'exécutant ; compter les tours réellement actifs, chef compris ; une place autorise chef → exécutant → chef. Sessions connues/inactives et tours actifs sont des notions différentes.
10. **Distribution** : chemins internes, exports, commandes npm, assets de prompts/migrations/bridge, données utilisateur hors code, namespace par chemin canonique du projet, politiques de conservation. Versions directes exactes et lockfile sous responsabilité unique.

Le socle TypeScript strict + Node 24 LTS + npm workspaces + SQLite et le découpage `packages/*` / `apps/cli` sont des **propositions initiales** à confirmer ou adapter par décision motivée. Un écart ne retire aucun critère de recette. Le driver SQLite, la bibliothèque TUI et les transports réellement supportés doivent être choisis sur preuves de versions, sans dépendance superflue.

## Douze scénarios de recette exigés

| ID | Preuve attendue |
|---|---|
| E2E-01 | Depuis dossier vide, chef planifie et délègue au moins deux missions utiles ; petite application construite, exécutée, vérifiée et documentée. |
| E2E-02 | Fixture planning chauffeur : décisions métier, backend/interface, persistance, droits, conflit de création et parcours préexistants préservés. |
| E2E-03 | Claude chef → exécutant Codex puis Codex chef → exécutant Claude, même domaine et outils transmis effectivement. |
| E2E-04 | Défaut contrôlé détecté par test indépendant ; run reste incomplet, mission corrective, nouvelle révision vérifiée. |
| E2E-05 | Contrat/décision remplacé entre missions ; nouvelle version reçue par la mission concernée, ancienne obsolète, propagation ciblée. |
| E2E-06 | Fermer/réouvrir TUI, interrompre exécutant, redémarrer service après intention : changements conservés, effets réconciliés, pas de double attribution/intégration, livraison tardive refusée. |
| E2E-07 | Jusqu'à sept sessions actives chef compris, missions légères indépendantes, ressources/routage/limite vérifiés. Rapport séparant capacité simulée et capacité réellement observée. |
| E2E-08 | Quota et permission refusée simulés de façon déterministe ; tâches indépendantes continuent. Diagnostic et permission contrôlée supportée sur chaque vrai provider, sans provoquer dépassement de quota ; réponse utilisateur liée à sa décision. |
| E2E-09 | Deux livraisons isolément valides mais incompatibles ensemble : candidat échoue, stable préservée, correction ouverte puis contrôles sur nouveau candidat. |
| E2E-10 | Tarball installé dans préfixe propre, binaire depuis deux projets, assets complets, aucune dépendance au checkout ; désinstallation/redémarrage sans perte des données conservées. |
| E2E-11 | Document sans Git, produit puis relu par sessions distinctes, empreintes/preuves, acceptation et clôture sans init/commit/merge artificiel. |
| E2E-12 | `max_active_agents: 1` : délégation non bloquante puis alternance chef/exécutant, jamais plus d'un tour actif. |

## Tests de risque et règles de preuve

- Rejeter cycle/dépendance inconnue ; ne pas lancer dépendance non acceptée. Deux réclamations concurrentes : une seule réussit. Rejeu et ancien propriétaire ne doublent aucun effet.
- Préserver critères et contraintes sous budget ; marquer source modifiée ; exclure secrets et variables de template non résolues. Expurger un secret de fixture avant affichage/export/persistance.
- Parseurs robustes aux lectures fragmentées, UTF-8 fragmenté, événement tronqué/inconnu/non JSON et sorties abondantes ; mémoire bornée, résultat terminal jamais perdu silencieusement.
- Refuser actions hors rôle/projet ; diagnostiquer auth/permission/quota séparément. Une note ne peut pas devenir une autorisation.
- Tester changement externe de cible, conflit, dépôt sale, chemin symbolique, chemin avec espaces, collision de port et arrêt sans suppression du travail.
- CI : install avec lockfile, format/lint/types, unités et intégration avec providers simulés, build et smoke du paquet. Aucun secret fournisseur requis dans la CI par défaut.
- Chaque preuve porte identifiant, version/révision, environnement, mode `static`/`simulated`/`live`, commande réelle ou observation justifiée, résultat, timestamps, critères et référence des logs. Pour intégration, lier base/source/candidat/tests/livré.
- `not_run`, `blocked`, `live_unverified` et `not_verified` sont des écarts visibles, jamais un succès. La validation de ce workpack n'est pas la validation d'Avity Crew.
- Plateformes cibles : macOS, Linux et Windows via WSL. Une ligne non essayée reste explicitement non vérifiée ; une recette macOS ne garantit pas les autres plateformes.

## Risques structurants et ordre conseillé

1. **Fausse clôture** : implémenter tôt les conditions d'acceptation (revue/preuves/version) et le document sans Git. Sinon toute la recette peut sembler aboutie avec seulement du texte d'agent.
2. **Interblocage à une place** : concevoir délégation et fin de tour avant la boucle L08. Un chef attendant synchroniquement son exécutant viole E2E-12.
3. **Autorité par prompt** : séparer identité/capacité du service et contenu des prompts dès les contrats. Les tests négatifs doivent couvrir rôle, projet et tentative.
4. **Intégration flottante** : vérifier des artefacts immuables et le candidat combiné exact ; les preuves isolées ne suffisent pas à avancer la branche stable.
5. **Reprise inventée** : classifier processus/tour/livraison et conserver ID natifs, génération, intentions et issue inconnue. Réconcilier avant relancer.
6. **Contexte opaque** : conserver le texte/références réellement envoyés et leurs empreintes ; une reconstruction ultérieure différente n'est pas la preuve du contexte reçu.
7. **Dépendance fournisseur non prouvée** : tests live d'outil/reprise dès L04/L05, puis scénario mixte L08. Un simple `--help` ou prompt sans bridge ne satisfait pas ces lots.
8. **Parallélisme de chantier différent de la capacité produit** : l'environnement de construction limite ses sous-agents à sa capacité disponible ; la recette du produit demande néanmoins le scénario jusqu'à sept sessions avec limites observées.

Cette sous-tâche n'a exécuté aucun test applicatif et n'a modifié ni registre de coordination ni code produit. La vérification est documentaire : lecture des sources listées et concordance des critères/identifiants ; la décision de cadrage et l'acceptation L00 appartiennent au coordinateur et à sa revue indépendante.
