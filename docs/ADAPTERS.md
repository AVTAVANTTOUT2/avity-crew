# Développer un adaptateur fournisseur

Les adaptateurs traduisent une CLI native en `ProviderAdapter`. Ils ne décident
ni des tâches, ni de leur acceptation, ni de l'identité autorisée pour un outil.
Le contrat de référence est `packages/contracts/src/index.ts` ; les implémentations
existantes sont décrites dans les guides [Claude](providers/claude.md) et
[Codex](providers/codex.md). La CLI produit ne charge pas de plugin arbitraire à chaud.

## Port et enregistrement

Un adaptateur expose un `id: ProviderId`, `probe()`, `start(request)` et
`resume(request & {native_session_id})`. `start` et `resume` retournent
synchroniquement un `ProviderProcess` : PID éventuel, flux `events`, promesse
`result`, `send`, `interrupt` et `stop`. La durée du tour ne bloque pas le retour
de `start`.

`ProviderRequest` fournit un cwd absolu, le prompt, le modèle nullable, le rôle,
les permissions natives et éventuellement un pont MCP. Un modèle `null` laisse
le fournisseur résoudre sa préférence native. Ne pas copier son authentification
dans Avity Crew. `probe()` doit distinguer les capacités `supported`,
`unsupported` et `unverified`, avec une référence de preuve et la version
effectivement inspectée. Une aide CLI disponible ne prouve pas un tour réussi.

Le runtime enregistre actuellement Claude et Codex dans son constructeur ; ses
tests peuvent injecter un tableau d'adaptateurs. Ajouter un nouvel identifiant
demande de coordonner `ProviderId`, les schémas de configuration, l'export et cet
enregistrement, puis de régénérer les contrats avec `npm run build`. Ne pas
modifier directement `packages/contracts/src/generated`. Le runner partagé
`runNative` accepte actuellement seulement `claude` et `codex` : l'étendre pour
un autre fournisseur nécessite un changement explicite et ses tests.

## Processus, événements et reprise

Pour les deux CLI existantes, `packages/providers/src/process.ts` fournit
`validateProviderRequest`, `classifyNativeError` et
`runNative(provider, binary, args, request, decode)`. Le décodeur reçoit une valeur
JSON native et retourne des `ProviderEvent[]`. Construire un tableau d'arguments,
sans shell, et envoyer le prompt sur stdin. Conserver stderr comme diagnostic
distinct, traiter la fragmentation UTF-8 et borner les données reçues.

Le runner borne actuellement une ligne JSON à 1 Mio, un diagnostic à 16 Kio, le
texte cumulé à 2 Mio et la file à 128 événements avec backpressure. Le consommateur
doit drainer `events` pendant qu'il attend `result`. Un dépassement de protocole
ne doit pas produire un succès silencieux.

- Conserver l'ID natif exact depuis l'événement de session, puis le vérifier
  pendant une reprise. Passer le nouvel input à cette conversation ; ne jamais
  utiliser une option « dernière session ».
- Émettre `provenance: 'live'` pour les observations natives et `'simulated'`
  pour les fixtures. Usage et coût restent absents si la CLI ne les expose pas.
- Un succès exige un résultat natif positif, la sortie du processus à zéro et
  aucune erreur ou interruption. Un refus de permission reste fatal même si la
  CLI quitte à zéro. Un avertissement non fatal ne peut être reconnu que par une
  règle étroite, documentée et couverte par fixture.
- Préserver les événements inconnus comme diagnostics bornés et expurgés. Ne pas
  dupliquer le texte entre événements intermédiaires et résultat final.
- Si l'input pendant un tour n'est pas supporté, `send` lève `UNSUPPORTED`.
  Le superviseur attend la fin du tour avant de fournir la mise à jour suivante.
- `interrupt` et `stop` doivent observer la fin du groupe possédé, y compris ses
  descendants. Ils ne peuvent pas transformer une interruption en acceptation
  métier. La reprise après crash relève aussi des [gardes POSIX](RECOVERY.md).

## Pont MCP et consentement natif

Le service transmet `bridge.command`, `args`, `env` et éventuellement
`approved_tools`. Les valeurs d'environnement du pont sont privées par défaut :
elles ne doivent figurer ni dans argv, ni dans le prompt, ni dans les diagnostics.
Les configurations MCP utilisent les noms de variables ; le processus reçoit
les valeurs par environnement. L'expurgation du texte doit préserver l'identité
exacte des champs de protocole tels que `native_session_id`.

`approved_tools` contient des noms canoniques de méthodes ToolCall, par exemple
`create_task` ou `publish_note`, sans préfixe serveur. Une liste absente garde le
comportement de compatibilité de l'adaptateur ; une liste vide n'accorde rien.
Refuser doublons, wildcards, injections et noms inconnus avant lancement. Les
adaptateurs existants appliquent un consentement natif par outil `crew`, sans
approbation globale. Le transport vérifie toujours l'ACL de la capability ; ce
consentement natif n'élargit pas les droits de l'agent. Les outils mutateurs ne
doivent pas être déclarés en lecture seule pour éviter un refus natif.

Codex conserve les préférences natives tout en limitant les serveurs MCP exposés
au pont `crew`, par inventaire borné à chaque start/resume. Voir son guide pour
les collisions et limites de préflight. Toute nouvelle CLI doit établir sa propre
stratégie documentée plutôt que supposer les mêmes options.

## Exemple exécutable sans modèle

Depuis la racine des sources, cet exemple exerce le port avec le fournisseur de
simulation déjà fourni. Il ne lance aucun processus fournisseur ni appel réseau :

```sh
npm ci
npm run build
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { FakeProvider } from './dist/packages/providers/src/index.js';

const adapter = new FakeProvider([
  { type: 'text', text: 'Exemple local', provenance: 'simulated' },
  { type: 'result', success: true, provenance: 'simulated' },
]);
const turn = adapter.start({
  cwd: process.cwd(),
  prompt: 'Exercer le port sans modèle',
  model: null,
  role: 'documenter',
  permissions: { sandbox: 'read-only', approval: 'never' },
});
const events = [];
const drain = (async () => {
  for await (const event of turn.events) events.push(event);
})();
const [result] = await Promise.all([turn.result, drain]);
assert.equal(result.success, true);
assert.equal(result.provenance, 'simulated');
assert.equal(result.text, 'Exemple local');
assert.equal(events.length, 2);
console.log('Port vérifié : simulation uniquement');
JS
```

Avant d'annoncer un nouvel adaptateur compatible, tester hors ligne argv/stdin,
événements fragmentés et inconnus, erreurs auth/quota/permission, secrets,
interruption et reprise exacte de deux sessions sans mélange. Les essais natifs
jetables doivent ensuite prouver édition, appel MCP réel, refus de permission et
reprise sur la version testée. Conserver séparément ces preuves, les simulations
et la recette intégrée du produit ; une nouvelle implémentation ne devient pas
qualifiée par l'exemple ci-dessus.
