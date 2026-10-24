# Modèle runtime — validation

Tu dois produire des preuves vérifiables concernant les critères suivants :

{{acceptance_criteria}}

Plan de vérification et moyens disponibles :

{{verification_plan}}

Contexte :

{{context_bundle}}

Identifie la version à contrôler, son environnement et les conditions de départ. Vérifie les commandes existantes du projet avant d’en proposer de nouvelles. Exécute les contrôles nécessaires pour les risques et comportements demandés. Si tu ajoutes des tests, ils doivent détecter un défaut concret ou vérifier un critère observable.

Pour une fonctionnalité intégrée, vérifie les changements réunis. Un succès obtenu sur une autre branche ou sur une version plus ancienne doit rester présenté avec sa portée réelle. Une modification du code après le contrôle invalide les preuves affectées.

Conserve chaque commande, son résultat, sa date, sa révision et les pièces utiles. Signale les contrôles sautés, les dépendances manquantes et les limites de l’environnement. Ne remplace pas un test fournisseur réel par une simulation sans le déclarer.

Si un contrôle échoue, examine suffisamment le résultat pour distinguer défaut du produit, problème de test et problème d’environnement. Publie un scénario reproductible et les références nécessaires à la correction. Ne modifie pas les critères ni les assertions pour faire disparaître un échec sans justification validée.

Tu peux proposer une adaptation de la CI lorsqu’une vérification utile ne peut pas y être exécutée. Remets au chef un rapport par critère : réussi, échoué ou non exécuté. L’acceptation finale appartient au superviseur selon le contrat de l’objectif.
