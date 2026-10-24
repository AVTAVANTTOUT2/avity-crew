# Revue préparatoire du registre de capacités L07

What this change does: le registre émet des capacités aléatoires, conserve uniquement leur empreinte dans les noms de fichiers privés, puis vérifie à nouveau l'autorité de l'acteur à chaque authentification. La clé propriétaire permet une identité utilisateur locale et les capacités agent suivent l'identité et la génération courantes.

**Source examinée : ec41b48e1020f6baabe9c60ef1ea98e3894547c8.** Relecteur : l05-codex. Date : 24 octobre 2026. Worktree réservé : /Users/zeldris/.codex/worktrees/avity-crew-cap-review, HEAD détachée sur cette source, propre avant et après contrôle. Aucun code L05/L07 modifié et aucun statut de lot L07 changé. Seul ce rapport canonique est écrit.

Périmètre lu : packages/supervisor/src/capabilities.ts, tests/capabilities.test.ts, interface Actor et méthodes/guards Store nécessaires. Hypothèses de mission respectées : issue(actor) est un appel interne de confiance du superviseur ; il ne s'agit pas d'une route MCP prenant un Actor fourni par un client. Usage personnel local, pas une plateforme multi-utilisateur hostile. La future frontière HTTP/MCP n'est ni implémentée ni validée par cette revue.

## Must fix

1. **[P2] Le chef valide sans tentative de tâche ne peut pas recevoir de capacité.** packages/supervisor/src/capabilities.ts:79–85, avant le cas chief:100.

   - **What this is:** Actor autorise attempt_id et task_id à null ; un chef n'est pas affecté à une tentative de tâche. Le guard Store.authority n'impose une tentative qu'aux rôles autres que user/chief, et le cas chief du registre demande task_id=null et la bonne génération de run.
   - **Problem:** assertCurrent valide actor.attempt_id comme Identifier avant d'atteindre ce cas chief. Avec rôle chief, task_id=null, attempt_id=null et generation=run.generation, issue rejette INVALID_INPUT. Il faut actuellement inventer un identifiant de tentative pour atteindre la branche chef, alors qu'aucune tentative correspondante n'est consultée. Le scénario worker unique du test actuel ne révèle pas ce blocage.
   - **Fix:** valider id/project_id/run_id en commun, traiter le chef avec sa génération de run, puis valider attempt_id uniquement dans la branche worker où une tentative est obligatoire. Ajouter un test chef sans tentative, puis sa révocation après remplacement de génération.
   - **If we skip it:** le superviseur ne peut pas émettre la capacité du chef avec l'Actor canonique sans tentative ; contourner le rejet avec un faux attempt_id masquerait l'incohérence. Ce finding porte sur un appel interne légitime, pas sur une usurpation à travers une route réseau supposée.

## Should fix

2. **[P3] Un enregistrement JSON valide mais de mauvaise forme sort en TypeError.** packages/supervisor/src/capabilities.ts:156–162.

   - **What this is:** authenticate lit un fichier privé, parse JSON et le caste directement en Actor avant les gardes courantes. Les erreurs de lecture ou de syntaxe JSON sont converties en FORBIDDEN.
   - **Problem:** remplacer dans le laboratoire le contenu d'un enregistrement existant par le JSON valide null contourne ce catch ; assertCurrent déréférence actor.id et l'API jette TypeError sans code CrewError. À l'inverse, le JSON tronqué est correctement rejeté FORBIDDEN. Le cas reste refusé, donc cette revue ne conclut pas à une acceptation indue de capacité.
   - **Fix:** vérifier la forme de l'Actor chargé avant de l'utiliser et produire un rejet contrôlé pour les données privées invalides, tout en conservant les codes de révocation des identités valides mais obsolètes. Ajouter null et les champs de mauvais type au test de reprise/rejet.
   - **If we skip it:** un registre endommagé peut provoquer une exception de programmation au lieu du rejet d'authentification attendu. Aucun comportement HTTP/500 n'est présumé ici.

## Contrôles réellement exécutés

Environnement : v26.12.0, macOS local.

| Commande / contrôle | Résultat |
| --- | --- |
| git rev-parse HEAD et git status --short --branch | Source exacte confirmée ; worktree propre |
| npm ci | exit 0 |
| npm run build | exit 0 ; contrats générés et TypeScript compilé |
| npm exec -- node --test dist/tests/capabilities.test.js | exit 0 ; 1/1 test ciblé passe |
| Probes Node en mémoire avec Store SQLite réel et dossiers jetables | exit 0 ; résultats ci-dessous |

Les probes n'ont écrit que leurs bases et fichiers privés dans des dossiers de laboratoire ensuite supprimés. Aucun token, clé propriétaire ou contenu sensible réel n'a été imprimé ou conservé dans ce rapport.

| Cas observé | Résultat exact utile |
| --- | --- |
| issue chef, task_id=null et attempt_id=null | CrewError / INVALID_INPUT — finding 1 |
| Chef de génération incorrecte, après passage de la validation Identifier | CrewError / REVOKED_CAPABILITY |
| owner.key et enregistrement nouvellement créés | Aucun bit groupe/autres ; fichiers privés |
| Enregistrement persisté | Token brut absent du JSON |
| Fermeture puis réouverture du Store SQLite et recréation du registre | Même capacité agent authentifiée |
| Fichier de capacité passé en permissions 0644 dans le laboratoire | CrewError / FORBIDDEN |
| Enregistrement JSON tronqué | CrewError / FORBIDDEN |
| Enregistrement JSON null | TypeError, code absent — finding 2 |

Le test existant vérifie en plus l'identité de session et de tentative réelle d'un worker, le rejet d'un autre rôle/projet, le token mal formé, la recréation du registre et la révocation après interruption puis réaffectation. La lecture des guards confirme les liens run/task/attempt, le rôle de tâche, la session propriétaire, la tentative active et les générations.

## Limites

Non exécutés : frontière HTTP/MCP et ses ACL, serveurs/providers, scénarios multi-utilisateurs hostiles, attaque par remplacement concurrent des fichiers, coupure machine après rename/fsync, Windows/Linux, tests exhaustifs de tous les états terminal/chef après remplacement. Les liens symboliques et la borne de taille sont présents dans le code mais n'ont pas fait l'objet d'un probe dynamique supplémentaire. Aucun de ces points n'est déclaré validé par le seul test local.

Verdict: fix 1 first. Corriger aussi 2 avant de raccorder ce rejet à la future frontière de service. La préparation est revue sur cette source précise ; cette revue ne vaut pas acceptation globale de L07.
