/// <reference path="../pb_data/types.d.ts" />
// Le champ `roles` ajouté depuis l'administration doublait `role`, n'était lu par aucun code et
// n'était pas protégé par `users.updateRule` : chaque utilisateur pouvait s'y écrire « admin ».
// Le rôle reste porté par `role`, seul champ lu par le serveur.
migrate((app) => {
  const users = app.findCollectionByNameOrId("_pb_users_auth_");
  if (users.fields.getByName("roles")) {
    users.fields.removeByName("roles");
    app.save(users);
  }
}, (app) => {
  const users = app.findCollectionByNameOrId("_pb_users_auth_");
  if (!users.fields.getByName("roles")) {
    users.fields.add(new SelectField({ id: "select3057528519", name: "roles", maxSelect: 1, values: ["admin", "editor", "viewer"] }));
    app.save(users);
  }
});
