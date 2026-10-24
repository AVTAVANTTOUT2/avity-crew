# Avity Crew

Application locale de terminal pour coordonner Claude Code et Codex sur un projet.
Construction en cours selon `avity-crew-workpack/` ; la version 0.1.0 est le
socle et ne lance pas encore une équipe réelle.

Node 24.15 minimum, Node 24.22.1 recommandé (`.nvmrc`), npm 11 et Git.

```sh
npm ci
npm run check
node bin/avity-crew.mjs --help
```

Les contrats partagés sont générés depuis le schéma runtime du workpack ; ne pas
modifier `packages/contracts/src/generated`. `npm run build` génère les types et
compile les modules ESM. `npm test` exécute uniquement des tests hors ligne à ce
stade ; aucune preuve live du produit n'est revendiquée.

Le paquet racine regroupe les modules compilés. Les workspaces privés exportent
leurs sources pour le développement ; les imports relatifs préservent la
topologie lors du build. Aucune publication externe n'est effectuée.
