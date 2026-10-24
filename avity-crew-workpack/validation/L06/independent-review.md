# Revue indépendante L06

What this change does: le module crée des worktrees de tâche, capture les contributions et prépare un candidat séparé. Les checks portent sur ce candidat ; la promotion compare la base attendue et garde la racine utilisateur hors des écritures de travail.

**Source : f8b2177e0749ad577127b34f2b62bbe63a3fbe53**, diff cff8ef6..f8b2177, six fichiers : docs/WORKSPACE.md, packages/workspace/src/{git,index,resources}.ts, tests/workspace.test.ts et tests/fixtures/workspace-worker.ts. Relecteur : l05-codex. Worktree /Users/zeldris/.codex/worktrees/avity-crew-l06, propre avant/après. Aucun code édité, aucun provider CLI ni sous-agent lancé.

## Must fix

1. **[P2] Un chemin documentaire avec .. peut sortir du périmètre de la tâche.** index.ts:130–136 et 491–511.

   - **What this is:** le préfixe de writePaths est contrôlé sur le chemin fourni ; le chemin réel est ensuite vérifié uniquement pour rester dans la racine du workspace.
   - **Problem:** avec write_paths=['docs'], excluded_paths=[] et documentPaths=['docs/../private.txt'], le préfixe docs/ passe, puis join/realpath ouvrent private.txt à la racine. Le probe sur Store SQLite réel a retourné accepted:true, changedPaths=['docs/../private.txt'], copiedDocuments:1. Ce fichier est hors de write_paths, sans qu'il soit nécessaire de l'énumérer explicitement dans excluded_paths. Une exclusion explicite private.txt est bien rejetée par le glob ; elle n'est pas le scénario du défaut.
   - **Fix:** vérifier le chemin relatif canonique contre les deux scopes avant writeArtifact, ou rejeter/normaliser les segments de traversée avant le contrôle. Ajouter la régression ci-dessous.
   - **If we skip it:** une livraison documentaire peut inclure un fichier hors mission alors que la collecte annonce le périmètre respecté. Ce n'est pas présenté comme une sortie de la racine ni comme une attaque multi-user.

Scénario exact à ajouter avec la fixture existante (le probe exécuté a construit les mêmes Run/Task/Attempt via les API Store publiques, sans Git) :

```ts
const f = fixture(t, false);
mkdirSync(join(f.root, 'docs'));
writeFileSync(join(f.root, 'private.txt'), 'synthetic outside scope');
const w = await f.manager.createWorkspace(
  { ...f.task(['docs']), mode: 'documentation' }, 'workspace:scope',
);
await assert.rejects(
  f.manager.collectDelivery(w.operationId, {
    writePaths: ['docs'], excludedPaths: [],
    documentPaths: ['docs/../private.txt'],
  }, 'delivery:scope'),
  code('OUTSIDE_SCOPE'),
);
```

Sur la source examinée, la dernière assertion échouerait : la collecte réussit et copie un document.

2. **[P2] Le timeout peut rendre la main avec un descendant encore actif.** git.ts:70–72, en lien avec l'escalade créée au timeout.

   - **What this is:** le timeout envoie SIGTERM au groupe et programme SIGKILL 500 ms plus tard. Le close du parent annule toujours cette escalade.
   - **Problem:** si le parent sort sur SIGTERM mais qu'un petit-fils du même groupe ignore SIGTERM et a ses stdio fermés, close arrive avant 500 ms ; le petit-fils reste actif. Probe réel : runCommand(...,400) retourne error='Command exceeded 400 ms', signal='SIGTERM', puis le heartbeat du petit-fils continue à avancer 900 ms après le retour. Le processus de test a été explicitement tué et son dossier supprimé.
   - **Fix:** terminer le groupe après un timeout même si le parent a déjà fermé ses stdio ; ne pas annuler la seule escalade nécessaire à ses descendants. Attendre cette fin avant de libérer le contrôle des checks. Ajouter une régression avec stdio:'ignore', pas seulement des enfants gardant les pipes ouverts.
   - **If we skip it:** un check annoncé arrêté peut continuer à écrire dans le candidat ou à occuper des ressources après le timeout.

Probe exact, sur le runCommand compilé de cette source : parent Node garde un setInterval et lance un petit-fils avec stdio:'ignore', unref(), sans detached ; le petit-fils ignore SIGTERM, écrit son PID et incrémente un fichier beat toutes les 50 ms. Il a aussi une sortie de garde à 5 s. Appel runCommand(dir,[node,'-e',parentSource,kidSource,pidFile,beat],400), lecture beat juste après retour puis après 900 ms. Résultat : before != after (le processus écrit encore). finally envoie SIGKILL au PID du petit-fils connu du laboratoire et supprime le dossier. Sources enfant/parent utilisées :

```js
// kidSource, argv[1]=pidFile, argv[2]=beat
const fs = require('fs');
process.on('SIGTERM', () => {});
fs.writeFileSync(process.argv[1], String(process.pid));
let n = 0;
setInterval(() => fs.writeFileSync(process.argv[2], String(++n)), 50);
setTimeout(() => process.exit(0), 5000);

// parentSource, argv[1]=kidSource, argv[2]=pidFile, argv[3]=beat
const { spawn } = require('child_process');
const c = spawn(process.execPath, ['-e', process.argv[1], process.argv[2], process.argv[3]], { stdio: 'ignore' });
c.unref();
setInterval(() => {}, 1000);
```

## Vérifications significatives

Environnement local v26.12.0, macOS. npm ci : exit 0 ; npm run build : exit 0 ; node --test dist/tests/workspace.test.js : **13/13, exit 0**. Les deux probes ci-dessus sont des commandes Node en mémoire sur les modules compilés, Store SQLite réel et fichiers Git/temporaires jetables, exit 0 ; aucun fichier source ajouté pour ces probes.

Les 13 tests ont réellement exercé racine sale et index préservés, deux contributions isolées et leur combinaison, conflits et index conservés, combinaison invalide, cible avancée/CAS et cible checkoutée refusées, reprise de promotion après mouvement de ref sans résultat SQL, nettoyage refusant fichiers ignorés/ultérieurs, documentation sans Git, autorisation d'initialisation, ports réellement occupés, bases distinctes, ressources nommées exclusives, deux managers et écrivain tué. Ces résultats ne couvrent pas les deux cas limites reproduits ci-dessus.

Lecture des guards : promotion exige candidat validated/proofs au bon commit, puis update-ref avec ancien SHA attendu ; les opérations Store terminales sont immuables. La reprise observe le SHA cible déjà voulu sans refaire le mouvement. Le raccourci de récupération du lock est explicitement limité à un contrôleur qui a constaté la mort du propriétaire. Le handoff de ports après release et le retrait manuel des verrous exclusifs d'un service mort sont documentés ; ils ne sont pas présentés comme un verrou OS permanent ou une sandbox.

Le coordinateur a signalé **main 0aede89, 80 tests Node26/24 verts**. Ce constat combiné est conservé comme preuve reçue, pas comme exécution indépendante de cette revue ni comme acceptation : les deux défauts restent bloquants.

## Bref recontrôle capfix

Diff ec41b48e1020f6baabe9c60ef1ea98e3894547c8..6cf2a4c06c9c6e919bb7fcfcbed6da9cbcc13c1b, limité capabilities.ts/tests. Les deux constats antérieurs sont corrigés à la lecture : attempt_id:null n'est plus validé comme Identifier avant la branche chief ; une valeur null/non-objet est rejetée FORBIDDEN avant déréférence. Les nouveaux tests couvrent chef sans tentative, génération chef incorrecte et JSON null avec CrewError. L'ancêtre 6cf est bien inclus dans 0aede89 (merge-base --is-ancestor : exit 0).

Ce recontrôle est **statique ciblé**, pas une nouvelle exécution indépendante des tests au commit 6cf ni une réouverture de toute la sécurité des capacités. La future frontière HTTP/MCP demeure hors qualification.

Verdict: fix 1 and 2 first. Aucun autre finding actionnable confirmé dans cette portée.

Not checked: CI distante, Linux/Windows, concurrence avec des commandes Git externes non coordonnées, panne machine/persistance de filesystem ; ces limites ne constituent pas une acceptation implicite. Aucun statut L06/L07 changé par ce rapport.


## Recontrôle indépendant du correctif 355b32a

Source exacte : 355b32a61d8e64576c1a61e039c5fd48f2abfd4d, checkout détaché de revue. Diff limité aux trois fichiers packages/workspace/src/git.ts, packages/workspace/src/index.ts et tests/workspace.test.ts. Aucune édition source, aucun fournisseur ni sous-agent.

**Constat 1 résolu dans cette portée.** La collecte documentaire rejette désormais les chemins non canoniques (segments vides, . ou .., forme absolue, lecteur Windows, antislash ou NUL). Elle contrôle ensuite aussi le chemin réel relatif contre les scopes, avant lecture et écriture d'artefact. Un alias de répertoire interne pointant hors du périmètre docs ne contourne donc plus l'allowlist. La nouvelle régression couvre docs/../private.txt et docs/alias/note.txt ; les tests documentaires positifs existants restent verts.

**Constat 2 résolu dans cette portée.** La fermeture du parent n'annule plus l'escalade SIGKILL programmée au timeout. Le résultat reste en attente tant que cette étape n'a pas exécuté la terminaison du groupe. La nouvelle régression démarre un descendant avec stdio fermés ignorant SIGTERM, constate son heartbeat, puis exige que celui-ci reste inchangé après le retour de runCommand. Elle est exécutée ici sur macOS, sans skip.

Contrôles réellement exécutés sur cette source : npm ci exit 0 (0 vulnérabilité signalée), npm run build exit 0, npm exec -- node --test dist/tests/workspace.test.js **15/15, exit 0, 0 skip**, git diff HEAD^ HEAD --check exit 0. Node v26.12.0 ; état Git vide après génération/build/tests. Journaux conservés : validation/L06/fix-review-build.log et validation/L06/fix-review-workspace-test.log. Ces 15 tests incluent les invariants Git/Store/ressources examinés initialement et les deux régressions ajoutées. La preuve rouge avant correctif a été fournie par le coordinateur ; je n'ai pas réexécuté sa nouvelle suite sur le parent de ce commit.

Verdict de ce recontrôle : **aucun finding actionnable restant sur les deux corrections ciblées**. Les deux constats initiaux ci-dessus sont conservés comme historique, puis clos par cette source. Cela ne remplace pas les contrôles de la combinaison finale ni l'acceptation de coordination. CI distante, autres OS et panne machine non exécutés. Aucun statut L06/L07 modifié.
