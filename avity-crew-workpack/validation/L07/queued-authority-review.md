# Revue indépendante — autorité après attente

**Point de départ :** HEAD `3aeb76783db4bd62eda3770128016025ca24d1fd`, diff non commis `capabilities.ts` / `coordinator.ts` d'empreinte SHA-256 `b680e02b0f7f40596c23cf0529d0254822e5265d464d586422798af65f8a04f2`.

**Verdict final : aucun finding bloquant restant confirmé après les correctifs du coordinateur `6983f6e` et `7f301ea`.** Deux fenêtres supplémentaires ont été prouvées pendant la revue, corrigées par le coordinateur et couvertes par des régressions rouges puis vertes.

| Frontière | Preuve avant correction | Résultat après correction |
| --- | --- | --- |
| Requête HTTP authentifiée puis mise en file | Ancien probe : capacité déjà refusée par Registry, mais tâche créée et version du run avancée après libération de la file | Revalidation à dequeue ; refus sans création de tâche ni intention métier |
| Promotion Git après une attente | Sur le diff initial : candidat réellement vérifié et revu, capacité révoquée avant le vrai appel de promotion ; HTTP `FORBIDDEN` mais **ref Git avancée**, tâche encore `in_review`, aucune acceptation | Callback transmis à `promoteIntegration`, vérifié dans la section sérialisée avant intention et avant `update-ref` après les lectures async ; **ref inchangée et refus HTTP** |
| Préparation d'intégration | Sur `6983f6e` : capacité révoquée pendant l'attente, puis HTTP success, candidat `validated` et vérification enregistrée | Callback dans la préparation et revalidation après son retour avant publication ; **aucune vérification publiée, aucune ref de livraison créée, refus HTTP** |

Les deux constats supplémentaires étaient des effets réellement observés sur des fixtures HTTP/Registry/Store/Git. Ils ne reposent pas sur une modification hostile du filesystem par un autre processus utilisateur.

## Autres frontières vérifiées

- Le principal produit par Registry porte une garde interne non énumérable qui relit son enregistrement et vérifie l'identité courante. Le modèle ne fournit ni principal ni fonction : l'acteur reste dérivé du canal HTTP authentifié.
- Une lecture `inspect_project` tenue après son travail async, puis révoquée avant retour, est refusée avec `FORBIDDEN` ; version et tâches restent inchangées.
- Une capture documentaire tenue avant son appel réel, puis révoquée, est refusée avant `submitHandoff` : zéro Handoff soumis. Les snapshots privés éventuellement observés ne deviennent pas une livraison acceptée.
- Les autres mutations Store de `dispatch` sont synchrones dans ce périmètre. Il n'y a pas de revalidation aveugle après leur transition propre : `submit_review` peut accepter sa tâche de contrôle et `finish_run` terminer son run sans transformer leur succès légitime en refus parce que cette transition rend ensuite la capacité obsolète. Les parcours positifs de revue/clôture et pause/reprise restent verts.
- `prepareIntegration` revalide avant les effets Git/worktree/cherry-pick/contrôles et avant observation finale ; le coordinateur revalide avant de publier les preuves. `promoteIntegration` revalide après ses lectures et immédiatement avant le lancement du changement de ref.

## Régressions et commandes exécutées

Commit de tests : **`e3dd17d07f46e500ec2326832d8c026d55e91d6a`**, fichier unique `tests/queued-authority.test.ts`, worktree `/Users/zeldris/.codex/worktrees/queued-promotion-regression/avity-crew`, propre après commit. Il ajoute les deux régressions Git avec une fixture commune ; les corrections produit ont été importées inchangées par cherry-pick (`d4236c8` pour `6983f6e`, `3850652` pour `7f301ea`).

Sous **Node 26.12.0**, macOS :

```text
npm run build
→ exit 0

node --test --test-name-pattern="revocation during an awaited promotion" dist/tests/queued-authority.test.js
→ rouge sur 3aeb767 : ref de livraison avancée

node --test --test-name-pattern="revocation during integration preparation" dist/tests/queued-authority.test.js
→ rouge sur 6983f6e : preuve publiée après révocation

node --test dist/tests/queued-authority.test.js
→ vert après les deux correctifs : 3/3, 0 ignoré

node --test dist/tests/queued-authority.test.js dist/tests/runtime.test.js dist/tests/plan-state.test.js dist/tests/capabilities.test.js
→ exit 0 : 30/30, 0 ignoré

prettier --check tests/queued-authority.test.ts
git diff --cached --check
→ exit 0
```

Les barrières retardent seulement l'entrée dans une vraie opération ; les vérifications, snapshots, revues, capacités, HTTP et changements de ref restent ceux du produit. Les assertions portent sur les effets durables. Les paramètres des wrappers sont transmis intégralement, y compris les callbacks ajoutés par les correctifs. Fixtures, sockets et processus Git propres au test sont nettoyés ; aucun processus extérieur n'est signalé.

**Limites :** aucun LLM ni CLI fournisseur lancé ; Node 24, suite globale, CI distante et recette native non rejoués par ce relecteur. Cette preuve couvre les frontières async demandées, pas une analyse globale de sécurité. Aucun produit ni contrat réécrit par cet agent ; seuls le test autorisé et ce rapport ont été modifiés.
