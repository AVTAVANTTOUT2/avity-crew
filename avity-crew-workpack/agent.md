# Consignes canoniques des agents constructeurs

## 1. Mission commune
Construire **Avity Crew** selon [docs/PRODUCT.md](docs/PRODUCT.md). Le résultat doit être une application locale utilisable, dotée d'un orchestrateur interchangeable, de sessions Claude/Codex réelles et d'une boucle complète de délégation, contrôle et livraison.

Le dossier fournit des exigences et des contrats initiaux. L'existant se vérifie avant tout changement. Les demandes explicites de l'utilisateur et les instructions déjà applicables au dépôt restent à respecter. Une divergence entre documents se résout par une décision tracée ; ne réécrire aucune instruction pour contourner une limite.

## 2. Séparer chantier et produit
Le script `scripts/coordination.py` gère **ce chantier**. Le code du futur produit doit implémenter son propre stockage, ses outils de coordination et sa gestion de sessions. Ne livrer ni ce script ni les exemples comme substitut à l'application.

Le produit à développer n'est pas Avity Transport. Les cas de planning sont des fixtures hypothétiques pour valider la coordination sur un projet cible. Aucune connexion de production ni modification métier d'un dépôt client n'est impliquée.

## 3. Avant d'agir
- Lire la mission, ses critères, ses dépendances et les décisions récentes.
- Vérifier le dépôt, la branche, les modifications non intégrées et le périmètre attribué.
- Réserver le lot auprès du registre canonique ; suivre [COORDINATION.md](COORDINATION.md).
- Utiliser le chemin absolu de ce registre commun depuis tous les worktrees.
- Si une dépendance n'est pas livrée, coordonner une exploration ou préparer un travail explicitement indépendant ; ne prétendre pas que la dépendance existe.
- Ne lire que le contexte utile, puis approfondir les fichiers actuels nécessaires.

## 4. Coordination effective
Un coordinateur garde l'objectif, le graphe de tâches, les décisions et la file d'intégration. Chaque exécutant possède une mission et une tentative identifiables. Un lot ne peut être réservé par deux exécutants actifs. Les sous-tâches parallèles d'un même lot sont attribuées explicitement par son responsable, avec périmètres disjoints ; le lot garde un seul propriétaire de livraison.

Publier une note lors d'une décision, d'un blocage, d'un changement d'interface ou d'un transfert. Les notes indiquent faits observés, références, hypothèses et action attendue. Les mises à jour sans conséquence ne nécessitent pas un long journal.

Si une modification affecte un autre agent, publier le changement avant d'imposer le nouveau contrat. Les divergences d'API, de schéma ou de dépendance doivent être arbitrées et versionnées. Les fichiers centraux de contrats et le lockfile ont un propriétaire d'intégration.

## 5. Travail simultané
Privilégier une branche et un worktree par tâche de code. Les agents évitent de modifier simultanément le même périmètre ; le coordinateur règle les exceptions. Les worktrees protègent des écrasements directs, pas de toutes les collisions ou de tous les accès système.

Attribuer séparément ports, bases de test, répertoires temporaires et services. Ne jamais réinitialiser des ressources communes pour faciliter son propre test. Préserver les changements de l'utilisateur ; ne pas nettoyer, forcer une fusion ou réinitialiser des fichiers inconnus.

Le coordinateur seul fait avancer la branche d'intégration désignée. Une revue porte sur une révision précise. Une validation finale porte sur la combinaison effectivement livrée.

## 6. Construire des fonctions réelles
Ne pas remplacer une intégration manquante par un indicateur fictif de succès. Les providers simulés sont identifiés comme `fake` et réservés aux tests. Une intégration réelle doit fournir événements, état de sortie, identifiant natif lorsqu'exposé, permissions, erreurs et reprise effectivement supportée.

Distinguer authentification CLI et clé API. L'application laisse les logiciels officiels gérer leurs comptes. Les prompts et les rapports ne contiennent pas de secrets. Aucun coût ni pourcentage de contexte n'est inventé : afficher la source, une estimation ou « indisponible ».

Les rôles sont assignés selon un besoin : une mission de refactoring doit expliquer le problème corrigé, et une modification de CI doit justifier l'insuffisance actuelle. Éviter le changement gratuit et les délégations sans résultat vérifiable.

## 7. Contrats et évolutions
[docs/DATA_MODEL.md](docs/DATA_MODEL.md) et [schemas/runtime.schema.json](schemas/runtime.schema.json) fixent les termes initiaux. L01 établit les types exécutables, les validations et la compatibilité. Toute évolution ultérieure modifie ensemble types, schémas, exemples, tests, prompts affectés et documentation.

Une simple chaîne « terminé » ne permet pas de changer l'état de tâche. Le moteur vérifie le livrable, l'identité de la tentative et les critères de transition. Une information issue d'un agent reste une proposition ou une observation, selon ses preuves ; elle ne remplace pas une décision utilisateur.

## 8. Livraisons et preuves
À chaque passation fournir :
- Objectif traité et critères couverts.
- Révision de départ et livrable final identifiable.
- Fichiers, interfaces et comportements modifiés.
- Commandes réellement exécutées, résultats et emplacements des preuves.
- Échecs, limites, vérifications non effectuées.
- Consignes pour les tâches suivantes.

Utiliser [templates/HANDOFF.md](templates/HANDOFF.md) pour le contenu humain et le format JSON de l'utilitaire pour la soumission du lot. Les deux formats ont des finalités différentes, documentées dans COORDINATION.md.

La revue est tracée avec son auteur et la version examinée. Ne pas inventer une seconde identité pour simuler une revue indépendante. Le coordinateur organise une vraie revue par une autre session ou par l'utilisateur lorsque nécessaire.

## 9. Tests proportionnés et fin de lot
Exécuter les vérifications pertinentes du lot. Corriger les échecs liés au travail. Étendre les tests pour un risque concret ou un critère de recette, pas pour produire artificiellement un volume de tests.

Les tests contractuels simulés vérifient le parseur et les scénarios reproductibles. Les essais réels vérifient le comportement des CLI installées. En l'absence d'une CLI ou d'une connexion autorisée, enregistrer `live_unverified`, continuer le travail indépendant et décrire le blocage.

Un lot reste en attente de validation tant que ses critères requis ne sont pas satisfaits. Ne pas diminuer les critères après un échec pour obtenir un statut vert. Réviser un critère seulement lorsqu'une décision justifiée modifie réellement le périmètre.

## 10. Reprises
Avant de réattribuer un travail interrompu, inspecter processus, branche, fichiers et dernier compte rendu. Un heartbeat expiré ne prouve pas qu'un agent est arrêté. Arrêter ou constater la fin de l'ancienne tentative, puis réattribuer explicitement avec une nouvelle génération.

Reprendre une conversation native seulement si sa version et son adaptateur le permettent. Sinon ouvrir une nouvelle session avec le dossier de reprise. La continuité du travail doit être établie à partir des artefacts ; la mémoire interne d'un fournisseur n'est pas supposée transférable.

## 11. Documentation et changelog
Le registre conserve les faits du chantier. Le coordinateur consolide les changements réellement acceptés dans [CHANGELOG.md](CHANGELOG.md). Les décisions durables sont documentées et liées à leurs lots. Les agents ne réécrivent pas simultanément le changelog commun ; ils fournissent leurs entrées dans la passation.

La documentation utilisateur, d'installation et de dépannage du produit est un livrable obligatoire de L11/L12. Ne pas confondre le présent cahier de construction avec ces guides d'usage finaux.

## 12. Autonomie
Poursuivre les actions autorisées et réversibles, résoudre les choix d'implémentation ordinaires et exploiter le parallélisme réel. Poser une question si une décision métier change le résultat, si une action nécessaire dépasse l'autorisation ou si un accès indispensable manque.

Les publications, messages externes, déploiements et actions de production suivent l'autorisation du run concerné ; le dossier ne les autorise pas globalement. Ne pas supprimer les protections des CLI ou de l'environnement pour éviter une question.

## 13. Rapport final
Utiliser [templates/RELEASE_REPORT.md](templates/RELEASE_REPORT.md). Présenter version, livraison, installation, fonctions validées, essais réels, reprises, plateformes vérifiées et limitations. Inclure les critères de [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md). La fin du chantier exige des preuves, pas seulement la fermeture des tâches.

