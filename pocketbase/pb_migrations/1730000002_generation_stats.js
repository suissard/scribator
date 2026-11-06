/// <reference path="../pb_data/types.d.ts" />

// Écriture automatique du livre (job BOOK) et statistiques de génération.
// duration_ms : durée réelle d'un job, pour calculer des moyennes sans recalculer les dates.

const KINDS = ["ANALYZE", "SAMPLE", "CHAPTER", "SCENE"];
const INDEX = "CREATE INDEX idx_ai_calls_project_purpose ON ai_calls (project, purpose)";

migrate(
  (app) => {
    const jobs = app.findCollectionByNameOrId("generation_jobs");
    jobs.fields.getByName("kind").values = [...KINDS, "BOOK"];
    jobs.fields.add(new NumberField({ name: "duration_ms", min: 0 }));
    app.save(jobs);

    const calls = app.findCollectionByNameOrId("ai_calls");
    calls.indexes.push(INDEX);
    app.save(calls);
  },
  (app) => {
    const jobs = app.findCollectionByNameOrId("generation_jobs");
    jobs.fields.getByName("kind").values = KINDS;
    jobs.fields.removeByName("duration_ms");
    app.save(jobs);

    const calls = app.findCollectionByNameOrId("ai_calls");
    calls.indexes = calls.indexes.filter((i) => i !== INDEX);
    app.save(calls);
  },
);
