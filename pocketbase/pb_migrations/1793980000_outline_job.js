/// <reference path="../pb_data/types.d.ts" />

// La trame devient un job (OUTLINE) : elle prend jusqu'à une minute et doit s'afficher
// dans la barre de génération comme les autres étapes.

const KINDS = ["ANALYZE", "SAMPLE", "CHAPTER", "SCENE", "BOOK"];

migrate(
  (app) => {
    const jobs = app.findCollectionByNameOrId("generation_jobs");
    jobs.fields.getByName("kind").values = [...KINDS, "OUTLINE"];
    app.save(jobs);
  },
  (app) => {
    app.db().newQuery("DELETE FROM generation_jobs WHERE kind = 'OUTLINE'").execute();
    const jobs = app.findCollectionByNameOrId("generation_jobs");
    jobs.fields.getByName("kind").values = KINDS;
    app.save(jobs);
  },
);
