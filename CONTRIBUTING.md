# Contribuer à Avity Crew

Les corrections ciblées, les retours reproductibles et les améliorations de
documentation sont bienvenus. Pour un changement important, ouvrir d'abord une
[issue](https://github.com/AVTAVANTTOUT2/avity-crew/issues/new/choose)
pour convenir du comportement attendu.

## Préparer le projet

Utiliser la version Node indiquée dans `.nvmrc` et npm 11, puis :

```sh
npm ci
npm run check
```

`check` lance le typage, Prettier, la compilation et les tests hors ligne des
providers. Les tests utilisent réellement SQLite, HTTP, Git et des processus
locaux ; ils ne nécessitent pas de compte Claude ou Codex. `npm pack` permet
ensuite de vérifier la distribution.

## Proposer une modification

1. Créer une branche depuis `main` et lire les instructions `AGENTS.md` applicables.
2. Limiter le diff au comportement demandé. Réutiliser les modules et conventions présents.
3. Pour un bug reproductible, ajouter un test qui échoue avant le correctif et passe après.
4. Mettre à jour les contrats et guides affectés, puis exécuter `npm run check`.
5. Ouvrir une PR en indiquant le résultat, les contrôles réellement exécutés et les limites.

Ne pas éditer `packages/contracts/src/generated` : `npm run generate` reconstruit
ces fichiers. Ne pas reformater les preuves historiques du workpack, qui sont
conservées avec leurs empreintes. `avity-crew-workpack/` décrit le chantier initial ;
son registre n'est pas le moteur du produit.

Ne joindre ni secrets, ni conversations privées, ni base SQLite réelle. Expurger
les logs avant de les partager. Les essais avec `scripts/live-claude.mjs` et
`scripts/live-codex.mjs` utilisent de vrais comptes et leurs quotas : les lancer
seulement avec une autorisation adaptée et distinguer leurs résultats des tests simulés.

## Commits et changelog automatique

Utiliser des titres [Conventional Commits](https://www.conventionalcommits.org/fr/v1.0.0/) :

```text
feat(cli): ajouter une commande de suivi
fix(storage): préserver les données après une interruption
docs: clarifier l'installation locale
```

Le titre d'une PR devient le commit lors d'une fusion squash. `feat`, `fix` et
`perf` alimentent les versions ; `docs`, `test`, `ci` et `chore` seuls ne
déclenchent pas une release. Signaler explicitement une rupture par `!` et
`BREAKING CHANGE:` dans le corps du commit.

Sur `main`, [Release Please](https://github.com/googleapis/release-please-action)
ouvre ou actualise une **PR de version** qui modifie `CHANGELOG.md`, la version
du paquet racine, son lockfile et la version affichée par la CLI. Le marqueur
`x-release-please-version` de la CLI doit être conservé. Le changelog historique
reste conservé.
La CI de cette PR est lancée explicitement par le workflow de release, car
le jeton GitHub Actions ne déclenche pas automatiquement un second workflow.

Après revue et fusion de cette PR, le workflow crée le tag et la release GitHub,
construit le tarball et joint une somme SHA-256. Les versions avant 1.0 sont
marquées comme préversions. Il n'effectue aucune publication sur npm.

Les guides et exemples contenant un numéro de version ne sont pas réécrits par
Release Please : les vérifier lors de la revue de la PR de version.
En cas d'échec d'envoi du paquet, reconstruire depuis le tag exact avec
`npm ci && npm run check && npm pack`, puis joindre le tarball et son empreinte
à la release correspondante.

## Licence et sécurité

Les contributions sont distribuées sous la [licence MIT](LICENSE) du projet.
Pour une faille potentielle, suivre [SECURITY.md](SECURITY.md) et utiliser un
signalement privé.
