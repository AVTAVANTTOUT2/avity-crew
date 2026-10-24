# L03 — Revue d'expurgation

Relecteur codex-coordinator, session distincte de l'auteur l03-context.
Source `6559d41750fc139081916d9e0840235e248a9baa` intégrée, avant acceptation.

Probe exécuté sur le module compilé, avec valeurs entièrement synthétiques :
`redactContext(JSON.stringify({api_key: secret, password: secret + ' with spaces'}))`.
Résultat dérivé : `jsonKeyValueExposed:true` ; le même probe `api_key=secret`
renvoie `plainKeyValueExposed:false`. Aucun secret réel n'a été lu ou affiché.

La regex de clé sensible attend = ou : après le nom et ne consomme pas le
guillemet JSON de fermeture de clé. Les sources ordinaires JSON sont transmises
comme chaînes, donc l'expurgation des objets structurés du compilateur ne résout
pas ce cas. Vérifier une vraie source sélectionnée jusqu'au prompt final, avec
valeurs citées et espaces/échappements, sans supprimer un fichier entier par
convenance ni affaiblir les critères.

Les 53 tests après intégration étaient verts ; ils ne couvrent pas ce cas.
Les autres gardes, sélection, budget et identité de prompt restent examinées et
ne sont pas remises en cause par ce finding ciblé.
