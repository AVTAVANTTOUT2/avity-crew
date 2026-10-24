# Avity Crew — dossier de construction
Version du dossier : **1.0.0** · Date : **24 octobre 2026**

Ce dossier permet à une équipe d'agents de construire **Avity Crew**, une application locale lancée avec `avity-crew` depuis le répertoire d'un projet. L'utilisateur donne un objectif ; un orchestrateur Claude Code ou Codex prépare les missions, fournit leur contexte, coordonne les sessions, vérifie leurs livraisons et poursuit jusqu'aux critères convenus.

**État initial : le dossier de travail est préparé ; l'application Avity Crew reste à développer.** Aucun lot de développement n'est déclaré terminé. Les scripts inclus aident à organiser et contrôler ce dossier ; ils ne sont pas le moteur du futur produit.

## Commencer
1. Extraire le dossier `avity-crew-workpack/` à la racine du dépôt destiné à construire Avity Crew.
2. Donner au premier agent le prompt de [START_HERE.md](START_HERE.md).
3. Le premier agent lit [agent.md](agent.md), inspecte l'existant, prend le rôle de coordinateur et démarre L00.
4. Les agents utilisent [COORDINATION.md](COORDINATION.md) pour réserver leur travail, transmettre les résultats et suivre les revues.
5. La livraison est jugée avec [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md), jusqu'au lot L12.

L'extraction ne remplace pas les instructions ni le code présents à la racine du dépôt. Pour ajouter les relais d'instructions sans effacer les fichiers existants :
```bash
python3 avity-crew-workpack/scripts/bootstrap.py --repo .
python3 avity-crew-workpack/scripts/bootstrap.py --repo . --apply
```
La première commande présente les changements prévus. La seconde ajoute des blocs identifiés dans `AGENTS.md`, `CLAUDE.md`, `agent.md` et les exclusions locales nécessaires dans `.gitignore`. Elle ne lance aucun agent, n'installe rien et n'envoie rien sur Internet.

## Où lire quoi
| Fichier ou dossier | Usage |
|---|---|
| [START_HERE.md](START_HERE.md) | Prompt initial prêt à transmettre au coordinateur |
| [agent.md](agent.md) | Consignes canoniques pour les agents qui construisent le produit |
| [AGENTS.md](AGENTS.md) et [CLAUDE.md](CLAUDE.md) | Relais explicites vers ces consignes |
| [ROADMAP.md](ROADMAP.md) et [lots/](lots/) | Découpage, dépendances, résultats et acceptation de chaque lot |
| [COORDINATION.md](COORDINATION.md) | Travail simultané, réservations, notes, passations et revues |
| [CHANGELOG.md](CHANGELOG.md) | Changements vérifiés et décisions de construction |
| [docs/](docs/) | Produit, architecture, état, contexte, fournisseurs, interface et recette |
| [prompts/](prompts/) | Prompts complets du futur orchestrateur et de ses agents |
| [schemas/](schemas/) | Contrats JSON initiaux à implémenter et valider |
| [templates/](templates/) | Modèles de mission, passation, revue, décision et rapport |
| [examples/](examples/) | Scénarios et données fictives explicitement identifiés |
| [scripts/](scripts/) | Coordination du chantier, installation des relais et validation du dossier |
| [validation/](validation/) | Résultat des vérifications du dossier livré ; aucun test live produit |

## Le périmètre complet de la V1
- CLI/TUI utilisable depuis le répertoire courant ; installation locale vérifiée.
- Orchestrateur interchangeable Claude Code/Codex ; exécutants mixtes.
- Contexte ciblé et traçable ; consignes, missions et mises à jour distinctes.
- Plan de tâches avec dépendances, décisions, messages et rapports persistants.
- Sessions locales réelles avec authentification gérée par les CLI officielles.
- Espaces Git distincts, ressources attribuées et intégration vérifiée.
- Fermeture/réouverture du terminal, reprises après incident et changement de chef.
- Documentation et journal des changements fondés sur les livraisons.
- Tests simulés pour la CI et recette réelle séparée, sans présenter l'une comme l'autre.

La capacité proposée est de sept agents actifs, chef compris, configurable. Cursor, une interface web et l'exécution distribuée sur plusieurs hôtes sont des extensions prévues par les interfaces ; la V1 fonctionnelle concerne Claude Code et Codex sur un hôte local.

## Deux contextes à ne pas confondre
**Construction :** les agents utilisent ce dossier pour écrire Avity Crew. Le registre de chantier est `coordination/STATE.json`, créé par l'utilitaire.
**Utilisation future :** Avity Crew aura son propre superviseur, sa base et ses sessions. Il pourra travailler dans Avity Transport ou tout autre projet. L'exemple du planning chauffeur est une recette fictive, pas une autorisation de modifier un logiciel en production.

## Définition de la fin
Les 13 lots doivent fournir leurs preuves, la commande installée doit fonctionner depuis deux projets distincts, une équipe réelle Claude/Codex doit accomplir un scénario, et les tests de reprise et d'intégration doivent être documentés. Si une connexion ou une machine manque, le résultat est déclaré partiellement vérifié avec un blocage précis : jamais « tout est fonctionnel » sans preuve.

Les critères de fin détaillés, la matrice des exigences et les essais de recette sont dans [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) et [docs/TRACEABILITY.md](docs/TRACEABILITY.md).

