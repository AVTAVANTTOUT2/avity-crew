# L04 — Reformulation de la passation

La revue `review-c5b25baf2b1746e4b29d991b7543f217` demandait uniquement de respecter la portée des champs du registre. `COORDINATION.md` définit `limitations` comme les éléments empêchant de considérer le lot complet et `next_steps` comme le travail restant dans ce lot.

La nouvelle passation conserve la source `bb5ec87f157ccaae76277ce04058854927ac8182`, les mêmes artefacts et leurs empreintes, ainsi que les mêmes vérifications réellement exécutées. Aucun test n'a été rejoué pour cette reformulation ; aucun résultat nouveau n'est revendiqué. Aucun fichier de code, fixture, contrat, manifest ou export n'a été modifié.

Les AC-L04-01 à AC-L04-05 restent inchangés et leur couverture demeure détaillée dans `checks.md`. La revue indépendante `integration-review.md` ne constate aucun finding de code L04 restant et rapporte 38 tests réussis sur la combinaison `b30b3301a826513ed706d248962df1baf44e8354`. Ces tests combinés sont les preuves du relecteur, pas de nouvelles exécutions attribuées à l'auteur L04.

Les deux tableaux sont désormais vides parce qu'aucun travail source L04 empêchant sa complétude n'a été identifié. Les capacités non prises en charge, l'absence de concurrence Claude live dans cet essai, le modèle et les valeurs détaillées d'usage non archivés, les plateformes non éprouvées, les pannes réelles non provoquées et les limites d'isolation restent intégralement consignés dans `checks.md`, `provider-capabilities.json`, `claude-live-report.json`, la documentation de l'adaptateur et la revue indépendante. Les responsabilités de L07 et la recette globale L11 ne sont pas présentées comme accomplies par L04.
