/// <reference path="../pb_data/types.d.ts" />

// Modèle de rédaction choisi pour un livre. Vide : AI_MODEL_CREATIVE s'applique.
// Protégé : le serveur vérifie que le modèle existe et gère les sorties structurées.

const GUARD = " && @request.body.model_creative:isset = false";

migrate(
  (app) => {
    const projects = app.findCollectionByNameOrId("projects");
    projects.fields.add(new TextField({ name: "model_creative", max: 200 }));
    projects.createRule += GUARD;
    projects.updateRule += GUARD;
    app.save(projects);
  },
  (app) => {
    const projects = app.findCollectionByNameOrId("projects");
    projects.fields.removeByName("model_creative");
    projects.createRule = projects.createRule.replace(GUARD, "");
    projects.updateRule = projects.updateRule.replace(GUARD, "");
    app.save(projects);
  },
);
