# L07 — combinaison vérifiée

Source : `ccbab6f1551c2f54056bece878b229377f1ef52f`, macOS arm64, 24 octobre 2026.

- `npm run check` : typage, Prettier, génération, build et **177/177** tests Node 26.12.0 réussis, zéro skip.
- `npm exec --yes --package=node@24.22.1 -- node --test 'dist/tests/**/*.test.js'` : **177/177** réussis, zéro skip.
- Reproduction indépendante des mêmes commandes par l00_provider_audit sur le même SHA : mêmes résultats.
- Les tests transport utilisent de vrais sockets HTTP et subprocess MCP ; les tests de propriété couvrent les concurrents/reconnexions, la portée des capabilities et l'arrêt de vue sans arrêt de service.
- Les trois régressions queued-authority couvrent la requête attendant en queue, la préparation Git et la promotion Git après révocation. Les refus HTTP ne publient aucune vérification ou cible avancée. Les transitions valides review/finish réussissent.
- La suite runtime vérifie providers mixtes simulés, capacité1, questions ciblées, pause/reprise, réattribution, remplacement du chef, sources requises entre worktrees et correction du candidat combiné.

Les sondes natives des providers installés sur ce SHA ont reçu un refus effectif MCP sous politique native : aucun tools/call effectué, erreur `permission`, résultat `success:false`, malgré sortie native0. La sonde Codex annotée inoffensive a été autorisée et reste un essai non concluant pour le refus ; la sonde sans annotations a effectivement échoué par permission.

La recette documentaire native antérieure est conservée dans native-doc-claude-report.json avec ses propres versions. La qualification native applicative finale appartient à L11/L12 et n'est pas revendiquée ici. Linux/WSL et CI distante : NON EXÉCUTÉS.
