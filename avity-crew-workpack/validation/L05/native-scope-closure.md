# Clôture du périmètre L05 et resoumission des métadonnées

Révision inchangée : git:7fb39c6ca135eddab75c1581843cd13965bf3f42. Cette resoumission succède au refus formel review-f3f6abafff2c444bb9396e23d733ea0f de la passation handoff-34591afafea146c094d26217bf93efae. Elle corrige uniquement le sens des tableaux de blocage limitations/next_steps : aucun travail L05 restant n'y est déclaré. Le rapport natif, ses limites effectives, les anciennes passations et les preuves isolées sont conservés sans modification. Aucun nouveau code, tour fournisseur ou réétiquetage de résultat.

## Critères du lot

| Critère | Preuve disponible sur la révision finale |
| --- | --- |
| AC-L05-01 normalisation | 34 tests locaux : événements, erreurs fournisseur, notifications inconnues, protocoles fragmentés et identités exactes ; événements réels SINGLE/PARALLEL2 |
| AC-L05-02 concurrence | native-parallel.json : deux sessions et leurs reprises simultanées, notes et fichiers propres à chacune sans mélange |
| AC-L05-03 reprise ciblée | SINGLE et PARALLEL2 : UUID explicites et nouveau contexte, résultats de fichiers vérifiés |
| AC-L05-04 arrêt | SINGLE : interruption réelle sans faux succès, puis reprise exacte récupérable ; refus MCP natif réel également observé |
| AC-L05-05 preuve réelle | Codex 0.163.0 installé, édition réelle et MCP ping réel dans dépôt jetable ; copies persistées et hashes vérifiés |

Les vérifications requises du lot sont satisfaites par les preuves décrites dans native-report.md et les quatre entrées tests de la passation originale. Le modèle demandé est null : la configuration native est héritée ; les outils MCP ambiants sont exclus par préflight et options par exécution. La revue et l'intégration combinée appartiennent au coordinateur et ne sont pas prétendues réalisées par cette resoumission.

## Classement des anciennes entrées informatives

1. **Modèle effectif/coût absents du JSONL, autre modèle explicite non essayé en live.** Limite d'observabilité de la voie choisie ; seuls les indicateurs réellement exposés sont transmis. La configuration de modèle explicite est testée hors ligne ; la recette réelle utilise le défaut natif accessible. Aucun critère ne demande d'inventer une identité/coût ni de qualifier chaque modèle.
2. **Préflight synchrone 10 s / 1 MiB, noms MCP ASCII et configuration supposée stable pendant le lancement.** Limites de compatibilité documentées du mécanisme choisi. Les entrées non prises en charge échouent explicitement avant le tour. La configuration installée et les deux périmètres avec/sans bridge ont une preuve native ; aucune extension de compatibilité n'est nécessaire pour livrer ce lot.
3. **Refus de fichier read-only non observé ; pannes réelles quota/auth/réseau, autres versions/OS/CI non exécutées.** Les déclarations sans appel d'outil ne sont pas comptées comme preuve. Le refus de permission réellement requis a été observé sur MCP natif sous politique never ; les classifications négatives restent couvertes hors ligne. La matrice publiée distingue ces limites de la validation réelle sur macOS/Codex 0.163.0. La qualification d'autres environnements n'est pas un critère restant de ce lot.
4. **Outils mutants et ACL HTTP-MCP L07 ; scratch éphémère.** Le bridge minimal ping exigé dès L05 a été vérifié. Les outils métier mutants, leur politique native par outil et les ACL du service sont un travail futur de L07. Les copies vérifiées et leurs hashes sont persistés ; le scratch original jetable n'est pas la seule preuve.
5. **Revue indépendante, intégration après dépendances partagées, export et tests combinés.** Responsabilités de l'intégrateur selon la séparation explicite des fichiers ; L05 n'a pas l'autorisation d'éditer les exports/manifests partagés. Ces étapes ne sont pas effacées du processus de coordination et ne constituent pas une implémentation L05 manquante.
6. **L07 doit consommer events pendant result, conserver les updates et appliquer les ACL/politiques étroites.** Contrat d'usage du runner et travaux du lot suivant, documentés pour la passation ; aucun faux support de send en cours de tour. send reste explicitement UNSUPPORTED.

Aucun critère L05 non satisfait identifié. Les tableaux bloquants de native-handoff-closure.json sont donc vides ; ces limites restent visibles ici, dans native-report.md et dans docs/providers/codex.md. Les hashes des 12 artefacts fichiers de la passation initiale ont été revérifiés identiques au moment de cette resoumission. Le changement ne modifie ni la source livrée ni le niveau de preuve des tests.
