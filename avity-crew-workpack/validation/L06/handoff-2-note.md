# L06 — Resoumission après revue indépendante

Propriétaire du lot : `l06-workspace` (session `/root/l00_acceptance_map`).
Source/candidat corrigé : `git:355b32a61d8e64576c1a61e039c5fd48f2abfd4d`.

Le coordinateur a corrigé les deux défauts confirmés de la première source :
traversée/alias de périmètre documentaire et descendant ignorant SIGTERM après
timeout. Il a exécuté les deux nouvelles régressions rouges avant correction,
puis les a fait passer. Le relecteur indépendant a relu cette source exacte et
exécuté les 15 tests workspace, sans finding restant ; voir
`independent-review.md` et ses journaux.

La combinaison corrigée a été installée/testée par le coordinateur en checkout
détaché : `npm ci --ignore-scripts`, puis `npm run check` 82/82 Node 26 et les
82 tests Node 24.22.1, sans skip ni annulation. Ces résultats sont attribués au
coordinateur et au relecteur ; le propriétaire L06 ne prétend pas les avoir
réexécutés depuis son autre worktree. Voir `final-checks.md`.

La passation et les contrôles initiaux restent conservés. Les deux constats
bloquants sont clos sur cette source ; les limitations de plateforme et de
commandes Git externes restent décrites dans les documents, sans fausse
validation générale ni nouveau blocage de lot. Aucun changement de code n'est
appliqué par cette resoumission.
