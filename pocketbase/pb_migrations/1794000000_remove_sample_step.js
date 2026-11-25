/// <reference path="../pb_data/types.d.ts" />

// La phase d'échantillon séparée est supprimée : le premier chapitre sert directement d'échantillon.
migrate(
  (app) => {
    app.db().newQuery("UPDATE projects SET status = 'STEP_3_OUTLINE_REVIEW' WHERE status = 'STEP_4_SAMPLE_REVIEW'").execute();
    const projects = app.findCollectionByNameOrId("projects");
    projects.fields.getByName("status").values = [
      "STEP_1_INPUT",
      "STEP_2_CONCEPT_REVIEW",
      "STEP_3_OUTLINE_REVIEW",
      "STEP_5_WRITING",
      "COMPLETED",
    ];
    app.save(projects);
  },
  (app) => {
    const projects = app.findCollectionByNameOrId("projects");
    projects.fields.getByName("status").values = [
      "STEP_1_INPUT",
      "STEP_2_CONCEPT_REVIEW",
      "STEP_3_OUTLINE_REVIEW",
      "STEP_4_SAMPLE_REVIEW",
      "STEP_5_WRITING",
      "COMPLETED",
    ];
    app.save(projects);
  },
);
