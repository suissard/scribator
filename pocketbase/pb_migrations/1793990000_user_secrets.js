/// <reference path="../pb_data/types.d.ts" />

// Stockage chiffré des clés API personnelles (ex. OpenRouter).
// Toutes les règles d'API sont nulles : seul le superuser serveur peut lire ou écrire cette collection.
// cascadeDelete : la suppression d'un compte efface immédiatement ses secrets.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const secrets = new Collection({
      type: "base",
      name: "user_secrets",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: "user",
          type: "relation",
          collectionId: users.id,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        { name: "openrouter_key_enc", type: "text", max: 4096 },
        { name: "openrouter_key_hint", type: "text", max: 32 },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_user_secrets_user ON user_secrets (user)"],
    });
    app.save(secrets);
  },
  (app) => {
    try {
      const secrets = app.findCollectionByNameOrId("user_secrets");
      app.delete(secrets);
    } catch {
      // déjà absente
    }
  },
);
