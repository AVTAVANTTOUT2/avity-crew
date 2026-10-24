# Schémas initiaux du futur produit

`runtime.schema.json` définit les contrats initiaux v1 : mission, contexte, livraison, preuve, décision, événement, capacités fournisseur et appels de coordination. `project-config.schema.json` décrit une configuration sans secret.

Ils utilisent JSON Schema draft 2020-12. Les références internes pointent sur `$defs`. En L01, produire les types TypeScript correspondants et choisir un validateur maintenu ; les tests vérifient leur équivalence avec ces schémas.

Le schéma ne suffit pas à établir les règles métier : identité réelle du canal, autorisations, existence de références, absence de cycle, validité d'une révision, vérité d'une preuve, idempotence et transitions sont contrôlées dans le superviseur. `CrewEvent.payload` est une enveloppe extensible ; L01 définit et valide les variantes d'événements effectivement utilisées.

Les données de `examples/` sont fictives. Les gabarits `build-handoff.json` et `build-review.json` concernent un autre contrat, celui du helper du chantier ; ils ne se valident pas avec le schéma runtime.

Le script `scripts/validate_pack.py` contrôle le sous-ensemble de JSON Schema utilisé ici et refuse un mot-clé qu'il ne sait pas interpréter lors de la validation des exemples. Ce validateur de dossier ne doit pas remplacer le validateur de production choisi en L01.

Les tableaux de critères non vides, les champs obligatoires et les enums constituent la forme de départ. Toute évolution doit modifier simultanément schémas, types, exemples, prompts affectés et tests.
