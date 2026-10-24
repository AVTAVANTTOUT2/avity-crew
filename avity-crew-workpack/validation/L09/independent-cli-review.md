# Revue indépendante L09 — CLI et terminal

Relecteur : `/root/l05_codex`, indépendant de l'auteur CLI `/root/l00_provider_audit`. Révision examinée : **`ccbab6f1551c2f54056bece878b229377f1ef52f`**, dans `/Users/zeldris/avity-crew`, le 24 octobre 2026. Lecture seule du produit ; aucun statut de lot modifié.

**Aucun finding bloquant ou correctif concret établi dans le périmètre CLI examiné.** Les commandes et les états observés sont cohérents avec les contrats examinés. La recette manuelle native complète de L09 reste distincte de cette revue.

## Contrôles de code

Lecture de `apps/cli/src/{args,main,service,view}.ts`, de leurs tests/driver PTY, de `docs/CLI.md`, du lot L09 et des preuves historiques `cli-checks.md` / `cli-handoff.json`. Vérification des interfaces client et des routes immédiates du coordinateur, sans rouvrir la revue du moteur métier.

- Le parsing refuse options, identifiants et combinaisons invalides avant création du projet/service. Les objectifs texte/fichier/stdin sont bornés ; les entrées fichier/stdin imposent UTF-8. L'objectif ne figure pas dans l'argv du service et n'est jamais interprété par un shell.
- La racine du projet est indépendante du dossier d'installation. Le service part détaché depuis son entrée compilée, avec journal privé et retrait des variables de capability de session ; le garde transport décide du singleton. Le client utilisateur lit la clé privée, tandis que les interfaces internes utilisent exclusivement leur capability ENV.
- Une réponse conserve l'ID de question. Les messages utilisent ToolCall, la version courante et des identifiants explicites ; `queued` n'est pas annoncé comme `delivered`. Inspection et export sont des lectures du service, pas des preuves fabriquées par la vue.
- `run` en TTY s'attache à l'ID effectivement créé. Une vue sans ID se fixe sur le premier run observé. La reconnexion conserve son curseur sans nouveau run ni rejeu de mutation ; une panne transitoire reste une enveloppe `ok:false`.
- `q`/Ctrl+C ferment la vue sans adresser stop/shutdown au service. La saisie en cours suspend le redessin, pas l'observation ; les contrôles ANSI/OSC sont nettoyés et le découpage évite de couper les graphèmes. Les événements sont bornés et les détails restent inspectables hors écran.
- Les codes distinguent commande acceptée, état final, attente utilisateur, attente non vérifiée et interruption. Le code 0 de création d'un run ne prétend pas valider son objectif. Un usage fournisseur inconnu reste indisponible, sans coût ni taux inventé.

## Vérifications exécutées

`node --test dist/tests/supervisor-transport.test.js dist/tests/cli.test.js dist/tests/capabilities.test.js`, Node **26.12.0** : **23/23 réussis, 0 échec, 0 skip**, exit 0, dont **11 tests CLI**. Les subprocess CLI, HTTP, SQLite et PTY sont réels ; les callbacks métier sont identifiés comme fake.

Les trois parcours PTY ont réellement tourné : assistant avec objectif multiligne collé et attachement au run retourné ; saisie Unicode préservée pendant événements/redimensionnement puis `q` ; Ctrl+C avec exit 130 et absence d'ordre d'arrêt au moteur. Les tests vérifient aussi chemins avec espaces, inspect-context exact fourni par le service de test, question référencée, messages ciblés, options des contrôles, fallback interne, codes de sortie et reconnexion sans doublon de séquence.

Une sonde supplémentaire a exécuté deux `init --json` concurrents, puis `status`, `service status` et `service stop` contre le vrai service compilé, dans un projet sans Git avec espaces et données privées jetables. Tous les appels ont réussi ; même projet retrouvé, PID du service observé sorti avant nettoyage. Aucun run ni modèle lancé.

## Limites

Pas de parcours manuel avec une équipe LLM native dans cette mission : les critères AC-L09-02/03/04 doivent aussi être rapprochés du futur rapport de recette intégré sur le candidat retenu. La preuve PTY automatisée ne couvre pas tous les émulateurs, accessibilités ou systèmes ; l'affichage très petit reste résumé et renvoie aux vues détaillées. Le détachement pendant une requête peut attendre son échéance HTTP bornée ; la vue ne tue pas le service pour accélérer sa fermeture. Node 24 et la suite globale ne sont pas revendiqués comme exécutés par ce relecteur ici. Les fichiers non suivis antérieurs ont été préservés.
