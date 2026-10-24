# L01 — Socle, contrats communs et CI minimale

**Dépendances :** [L00](L00-audit.md).  
**Résultat :** un dépôt compilable avec des contrats partagés, des points d’extension et les premières vérifications automatisées.  
**Propriétaire conseillé :** agent socle, avec revue de l’intégrateur.

**Références :** [consignes de construction](../agent.md), [ARCHITECTURE](../docs/ARCHITECTURE.md), [DATA_MODEL](../docs/DATA_MODEL.md).

## Objectif

Donner aux agents une base commune avant de répartir stockage, contexte et fournisseurs. Les contrats doivent représenter le fonctionnement du produit et permettre des évolutions versionnées. La CLI livrée ici reste une structure de développement : elle ne doit pas annoncer qu’une équipe réelle travaille tant que cette boucle n’existe pas.

## Entrées

Utiliser l’audit et les décisions L00, le modèle de données, les protocoles de mission et de livraison, le périmètre V1 et la traçabilité des exigences. Les chemins d’implémentation sont figés ici à partir des périmètres logiques du backlog.

## Travail à réaliser

1. Créer ou adapter le workspace TypeScript strict, les scripts npm, les exports de packages et la configuration de construction. Définir un graphe de dépendances sans couplage du domaine à une interface terminal ou à un fournisseur.
2. Définir les modèles partagés : projet, objectif, tâche, tentative, session, décision, paquet de contexte, message, livraison, preuve de vérification, espace de travail et événement. Relier les éléments par identifiants explicites.
3. Fixer les états autorisés et leurs transitions. Différencier une tâche livrée, une tâche acceptée et un objectif terminé ; un processus sorti avec un code zéro ne suffit pas à conclure qu’une mission a réussi.
4. Définir une interface d’adaptateur indépendante des fournisseurs : détection de capacités, lancement, réception d’événements, continuation ou reprise, interruption et classification des erreurs. Une opération non prise en charge doit être explicitement refusée.
5. Définir les enveloppes des actions du chef, des notes et des livraisons. Prévoir des versions de schéma, une validation à la frontière et une réponse d’erreur exploitable sans corruption de l’état.
6. Écrire un adaptateur de simulation déterministe pour les tests. Ses événements et résultats portent une provenance de simulation ; il ne peut jamais satisfaire une preuve d’intégration réelle.
7. Mettre en place une CI initiale qui installe avec le lockfile, vérifie les types, construit le projet et exécute les tests de contrats. Les comptes fournisseur restent absents de cette CI par défaut.
8. Créer les points d’entrée documentés et la commande d’aide initiale. Tout comportement non implémenté est annoncé comme tel.

## Interfaces et propriété

Les contrats communs appartiennent à ce lot. Une fois acceptés, toute modification impactant un autre lot passe par une décision et une notification aux propriétaires concernés. Les types bruts des CLI externes restent dans leurs adaptateurs ; le reste du produit manipule les événements normalisés.

Le stockage possède les transitions persistantes, le superviseur possédera les processus, et l’orchestrateur utilisera leurs actions publiques. La TUI ne modifie pas directement les tables ou les fichiers d’état.

## Vérification

Tester des entrées valides et des erreurs réalistes : identifiant manquant, version inconnue, transition invalide, preuve rattachée à une autre tentative et événement fournisseur inconnu. Vérifier que les packages se construisent depuis un checkout propre. Les tests doivent exercer les invariants, pas seulement répéter des constantes du code.

## Critères d’acceptation

- **AC-L01-01 — Construction reproductible :** installation avec lockfile, vérification des types et construction réussissent dans un environnement propre.
- **AC-L01-02 — Contrats partagés :** deux modules indépendants peuvent échanger une mission et une livraison sans types fournisseur.
- **AC-L01-03 — Rejets explicites :** une entrée invalide ne crée aucun état partiel ni succès apparent.
- **AC-L01-04 — Simulation identifiée :** les tests rapides peuvent fonctionner hors ligne ; leurs résultats sont clairement distingués des essais live.
- **AC-L01-05 — CI initiale :** les vérifications de base s’exécutent sans clé fournisseur et sans publication de paquet.

## Passation

Livrer les chemins réellement retenus, commandes, contrats versionnés et exemples de messages. L02, L04 et L05 peuvent démarrer en parallèle après acceptation. Les changements transversaux ultérieurs doivent préserver ou migrer les données et consommateurs concernés.

