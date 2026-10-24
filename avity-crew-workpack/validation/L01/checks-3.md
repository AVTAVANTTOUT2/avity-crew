# L01 — Dernier correctif de simulation

Source/candidat `git:4767e10e03806309bc629d4dc1e65cedc0604f0a`.
Base `git:e42d658c2e2cf55bc70973e4f6b893d3b61850ba`.

Le test ajouté « a simulated error without provider details still prevents
success » a été exécuté avant correction : `npm test`, exit 1, 11 réussis et
1 échec (`true !== false`). Après correction, `npm run check` : exit 0,
typage/format et 12/12 tests. Le faux provider fournit une erreur protocol
explicite lorsque l'événement error est dépourvu de détail.

Les revues antérieures et les validations de Node 24 restent conservées ; une
nouvelle revue indépendante vérifie ce candidat final. CI distante non exécutée.
