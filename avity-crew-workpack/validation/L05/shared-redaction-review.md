# Revue indépendante — b24a2ce

What this change does: le correctif conserve les identifiants de session de protocole sans les expurger. Il limite le masque des sorties aux variables dont le nom semble sensible, pour éviter qu'une valeur ordinaire comme le port 1 corrompe du texte et les identités.

Auteur : l05-codex. Date : 24 octobre 2026. Source examinée : b24a2ce9fe28621a28112a1914635cc57f64f7ae ; consommation locale 4f2499a. Diff relu, appelants Claude/Codex et contrat ProviderRequest/validation runtime vérifiés. Charge supposée : équipe locale, un à sept agents ; le cas ci-dessous existe avec un seul enfant. Aucun process.ts modifié par cette revue.

## Must fix

1. **[P2] Une capacité bridge sous un nom non reconnu peut maintenant entrer dans les événements et le résultat.** Fichier packages/providers/src/process.ts, construction de secrets, lignes 78–87.

   - **What this is:** bridge.env permet au superviseur de transmettre des valeurs à la CLI et au bridge. Le contrat actuel accepte un Record<string,string> arbitraire et le validateur ne requiert pas TOKEN, SECRET ou CAPABILITY dans les noms.
   - **Problem:** après ce correctif, une valeur opaque sous CREW_HANDLE n'est plus masquée si l'enfant l'écrit dans son texte. Le probe synthétique du runner compilé donne nativeIdStable=true et unclassifiedBridgeValueExposed=true ; auparavant toutes les valeurs bridge étaient candidates à l'expurgation. Ce cas ne dépend d'aucun secret réel, fournisseur ou journal personnel.
   - **Fix:** maintenir les identités de protocole séparées du texte, comme dans le correctif, puis définir une protection complète des capacités bridge : soit toutes les valeurs opaques de bridge doivent être masquées, avec un traitement explicite des réglages publics courts, soit le contrat doit exiger et valider des noms sensibles pour chaque valeur d'accès. Ne pas laisser cette hypothèse implicite dans une regex. Ajouter la régression CREW_HANDLE opaque au propriétaire partagé. Aucune extension de contrat n'est appliquée ici.
   - **If we skip it:** des capacités sous des noms actuellement autorisés peuvent être conservées dans logs, événements, résultat et interface en clair. Les tests TOKEN/CAPABILITY seuls ne couvrent pas ces noms autorisés.

## Points vérifiés et portée

La séparation des IDs est correcte pour la reprise exacte et le test AVITY_CREW_PORT=1 couvre la régression annoncée. Le nouveau test CAPABILITY couvre bien ce nom sensible. Les masques de formes Bearer/sk- et les bornes de flux ne sont pas supprimés.

Probe exécuté hors ligne : runNative avec un enfant Node, session-1, env bridge CREW_HANDLE=valeur synthétique, puis écho de cette valeur dans un événement text et résultat natif réussi. Seuls les booléens ont été archivés dans shared-redaction-probe.json ; aucune valeur d'accès réelle n'est utilisée ou publiée.

Verdict: fix 1 first, ou faire trancher explicitement le contrat des noms sensibles avant de prétendre garantir l'expurgation de toute capacité bridge.

Not checked: pannes fournisseur réelles, comportement de toutes les clés d'environnement héritées et toute nouvelle convention de nommage L07 non encore contractuelle.

## Clôture après correctif partagé d229058

Source complémentaire d22905802377284820f288f8ef4a61862861fe5c, consommation locale 4b95a32. Diff relu : toutes les valeurs bridge redeviennent privées sans toucher les clés de session. Reprise indépendante du même probe compilé : nativeIdStable=true, unclassifiedBridgeValueExposed=false. Le finding 1 est corrigé ; le test partagé CREW_HANDLE et la confidentialité du port court sont présents. npm run check sur ce consommateur : 33/33 tests verts.

Verdict final pour le correctif partagé : Ship. Aucun finding ouvert sur ce petit diff ; pannes fournisseur et nouveaux comportements métier non examinés.
