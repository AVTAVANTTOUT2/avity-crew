# Sécurité

## Signaler une vulnérabilité

Utiliser le [signalement privé GitHub](https://github.com/AVTAVANTTOUT2/avity-crew/security/advisories/new).
Ne pas publier de faille exploitable, de jeton ou de conversation privée dans
une issue publique.

Décrire la version et la plateforme, les prérequis, les étapes minimales de
reproduction et l'impact observé. Utiliser des données synthétiques ; expurger
les logs et les chemins privés. Aucun délai de réponse contractuel n'est garanti.

## Périmètre

Les correctifs ciblent la dernière version publiée. Les anciennes versions
0.x ne disposent pas d'un engagement de maintenance distinct.

Les frontières sensibles incluent le service local authentifié, les identités
et autorisations des agents, les outils MCP, les chemins de fichiers, les
workspaces Git et la persistance SQLite. Une preuve de modèle ou un contenu
de dépôt reste une donnée à examiner.

Avity Crew utilise des CLI natives capables de modifier des fichiers et de
consommer les quotas de vos comptes. Lire les contraintes d'une mission et
préserver les sauvegardes du projet. Les contrôles POSIX ne constituent pas
une sandbox universelle ; la qualification native Linux/Windows reste à effectuer.
