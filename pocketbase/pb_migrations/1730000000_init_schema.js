/// <reference path="../pb_data/types.d.ts" />

// Schéma V3.1 (§3). Attention, pièges PocketBase :
// * un champ text avec max=0 est plafonné à 5 000 caractères : tout champ long a un max explicite ;
// * les champs select n'ont pas de valeur par défaut : voir pb_hooks/defaults.pb.js ;
// * ai_calls.project n'est PAS en cascade : supprimer un projet ne doit pas remettre le budget à zéro.

const LONG = 5000000; // ~5 Mo : texte intégral d'un chapitre, prompts complets
const JSON_MAX = 5000000;

const noneSet = (fields) => fields.map((f) => `@request.body.${f}:isset = false`).join(" && ");

const PROJECT_PROTECTED = [
  "status",
  "reference_meta",
  "style_matrix",
  "story_bible",
  "sample_ai_original",
  "sample_draft",
  "archived_synopsis",
  "synopsis_covers_up_to",
];
const CHAPTER_PROTECTED = [
  "project",
  "chapter_number",
  "status",
  "post_writing_summary",
  "stale_reason",
  "approved_at",
];
const SCENE_PROTECTED = [
  "chapter",
  "scene_number",
  "ai_original_content",
  "draft",
  "status",
  "scene_break_before",
  "truncated",
];

const autodates = () => [
  { name: "created", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];
const text = (name, opts = {}) => ({ name, type: "text", max: LONG, ...opts });
const select = (name, values, opts = {}) => ({ name, type: "select", maxSelect: 1, values, ...opts });
const relation = (name, collectionId, opts = {}) => ({
  name,
  type: "relation",
  collectionId,
  maxSelect: 1,
  ...opts,
});
const json = (name) => ({ name, type: "json", maxSize: JSON_MAX });

migrate(
  (app) => {
    // --- users (§3.1)
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(new SelectField({ name: "role", maxSelect: 1, values: ["admin", "member"] }));
    users.fields.add(new NumberField({ name: "monthly_budget_usd", min: 0 }));
    users.fields.add(new DateField({ name: "accepted_terms_at" }));
    users.createRule = null; // pas d'inscription publique
    users.listRule = "id = @request.auth.id";
    users.viewRule = "id = @request.auth.id";
    users.updateRule = `id = @request.auth.id && ${noneSet(["role", "monthly_budget_usd", "accepted_terms_at"])}`;
    users.deleteRule = "id = @request.auth.id";
    app.save(users);

    // --- projects (§3.2)
    const projects = new Collection({
      type: "base",
      name: "projects",
      listRule: "user = @request.auth.id",
      viewRule: "user = @request.auth.id",
      deleteRule: "user = @request.auth.id",
      createRule: `@request.auth.id != "" && @request.body.user = @request.auth.id && ${noneSet(PROJECT_PROTECTED)}`,
      updateRule:
        `user = @request.auth.id && ${noneSet(["user", ...PROJECT_PROTECTED])}` +
        ` && (@request.body.reference_file:isset = false || @request.auth.accepted_terms_at != "")`,
      fields: [
        relation("user", users.id, { required: true, cascadeDelete: true }),
        text("title", { required: true, max: 300 }),
        text("language", { max: 20 }),
        text("genre", { max: 200 }),
        text("audience", { max: 200 }),
        select("status", [
          "STEP_1_INPUT",
          "STEP_2_CONCEPT_REVIEW",
          "STEP_3_OUTLINE_REVIEW",
          "STEP_4_SAMPLE_REVIEW",
          "STEP_5_WRITING",
          "COMPLETED",
        ]),
        select("length_preset", ["NOUVELLE", "NOVELLA", "ROMAN", "ROMAN_LONG", "CUSTOM"]),
        { name: "target_chapter_count", type: "number", min: 1, max: 60, onlyInt: true },
        { name: "target_words_per_chapter", type: "number", min: 500, max: 8000, onlyInt: true },
        {
          name: "reference_file",
          type: "file",
          maxSelect: 1,
          maxSize: 20 * 1024 * 1024,
          protected: true,
        },
        json("reference_meta"),
        text("raw_ideas"),
        json("style_matrix"),
        json("story_bible"),
        text("reformulated_concept"),
        text("sample_text"),
        text("sample_ai_original"),
        text("sample_draft"),
        text("archived_synopsis"),
        { name: "synopsis_covers_up_to", type: "number", min: 0, onlyInt: true },
        ...autodates(),
      ],
    });
    app.save(projects);

    // --- chapters (§3.3) : création, suppression et renumérotation passent par le serveur
    const chapters = new Collection({
      type: "base",
      name: "chapters",
      listRule: "project.user = @request.auth.id",
      viewRule: "project.user = @request.auth.id",
      createRule: null,
      deleteRule: null,
      updateRule: `project.user = @request.auth.id && ${noneSet(CHAPTER_PROTECTED)}`,
      fields: [
        relation("project", projects.id, { required: true, cascadeDelete: true }),
        { name: "chapter_number", type: "number", min: 1, onlyInt: true },
        text("title", { max: 500 }),
        text("brief_summary"),
        json("key_events"),
        { name: "target_words", type: "number", min: 0, max: 100000, onlyInt: true },
        { name: "user_edited_outline", type: "bool" },
        select("status", ["PENDING", "PLANNED", "GENERATING", "REVIEW", "APPROVED", "STALE", "ERROR"]),
        text("post_writing_summary"),
        text("stale_reason", { max: 1000 }),
        { name: "approved_at", type: "date" },
        ...autodates(),
      ],
      indexes: ["CREATE INDEX idx_chapters_project_num ON chapters (project, chapter_number)"],
    });
    app.save(chapters);

    // --- scenes (§3.4)
    const scenes = new Collection({
      type: "base",
      name: "scenes",
      listRule: "chapter.project.user = @request.auth.id",
      viewRule: "chapter.project.user = @request.auth.id",
      createRule: null,
      deleteRule: null,
      updateRule:
        `chapter.project.user = @request.auth.id && ${noneSet(SCENE_PROTECTED)} && (` +
        `(status = "REVIEW" && ${noneSet(["beat", "target_words"])}) || ` +
        `(status = "PENDING" && ${noneSet(["content"])})` +
        `)`,
      fields: [
        relation("chapter", chapters.id, { required: true, cascadeDelete: true }),
        { name: "scene_number", type: "number", min: 1, onlyInt: true },
        text("beat"),
        { name: "target_words", type: "number", min: 0, max: 100000, onlyInt: true },
        text("content"),
        text("ai_original_content"),
        text("draft"),
        select("status", ["PENDING", "GENERATING", "REVIEW", "APPROVED"]),
        { name: "scene_break_before", type: "bool" },
        { name: "truncated", type: "bool" }, // badge « scène tronquée » (§5.6)
        ...autodates(),
      ],
      indexes: ["CREATE INDEX idx_scenes_chapter_num ON scenes (chapter, scene_number)"],
    });
    app.save(scenes);

    // --- versions (§3.5)
    const versions = new Collection({
      type: "base",
      name: "versions",
      listRule: "project.user = @request.auth.id",
      viewRule: "project.user = @request.auth.id",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        relation("project", projects.id, { required: true, cascadeDelete: true }),
        select("target_collection", ["projects", "scenes"], { required: true }),
        text("target_id", { required: true, max: 50 }),
        select(
          "field",
          ["sample_text", "content", "reformulated_concept", "style_matrix", "story_bible"],
          { required: true },
        ),
        text("content"),
        select("reason", ["before_regenerate", "before_restore", "before_patch"], { required: true }),
        ...autodates(),
      ],
      indexes: ["CREATE INDEX idx_versions_target_field ON versions (target_id, field, created)"],
    });
    app.save(versions);

    // --- pending_changes (§3.6)
    const pending = new Collection({
      type: "base",
      name: "pending_changes",
      listRule: "project.user = @request.auth.id",
      viewRule: "project.user = @request.auth.id",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        relation("project", projects.id, { required: true, cascadeDelete: true }),
        select("kind", ["BIBLE_PATCH", "STYLE_SUGGESTION"], { required: true }),
        relation("source_chapter", chapters.id),
        json("payload"),
        select("status", ["PENDING", "ACCEPTED", "REJECTED"], { required: true }),
        ...autodates(),
      ],
    });
    app.save(pending);

    // --- generation_jobs (§3.7)
    const jobs = new Collection({
      type: "base",
      name: "generation_jobs",
      listRule: "user = @request.auth.id",
      viewRule: "user = @request.auth.id",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        relation("user", users.id, { required: true, cascadeDelete: true }),
        relation("project", projects.id, { required: true, cascadeDelete: true }),
        select("kind", ["ANALYZE", "SAMPLE", "CHAPTER", "SCENE"], { required: true }),
        text("target_id", { max: 50 }),
        select("status", ["RUNNING", "DONE", "CANCELLED", "FAILED"], { required: true }),
        { name: "cancel_requested", type: "bool" },
        json("progress"),
        text("error_message", { max: 2000 }),
        { name: "started_at", type: "date" },
        { name: "finished_at", type: "date" },
        ...autodates(),
      ],
      indexes: ["CREATE INDEX idx_jobs_project_status ON generation_jobs (project, status)"],
    });
    app.save(jobs);

    // --- ai_calls (§3.8)
    const admin = '@request.auth.role = "admin"';
    const aiCalls = new Collection({
      type: "base",
      name: "ai_calls",
      listRule: admin,
      viewRule: admin,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        relation("user", users.id, { required: true, cascadeDelete: true }),
        relation("project", projects.id), // sans cascade : le coût reste compté
        relation("job", jobs.id),
        text("request_id", { max: 100 }),
        select("purpose", [
          "style_extract",
          "concept",
          "outline",
          "sample",
          "scene_plan",
          "scene_write",
          "chapter_summary",
          "bible_patch",
          "style_learning",
          "synopsis_compress",
          "test",
        ]),
        text("prompt_version", { max: 100 }),
        text("model", { max: 100 }),
        { name: "input_tokens", type: "number", min: 0 },
        { name: "output_tokens", type: "number", min: 0 },
        { name: "cache_read_tokens", type: "number", min: 0 },
        { name: "cache_write_tokens", type: "number", min: 0 },
        { name: "cost_usd", type: "number", min: 0 },
        { name: "duration_ms", type: "number", min: 0 },
        text("stop_reason", { max: 50 }),
        select("status", ["OK", "ERROR", "CANCELLED", "REFUSED"]),
        text("error_message", { max: 2000 }),
        text("prompt_snapshot", { max: 20000000 }),
        text("response_snapshot", { max: 30000 }),
        ...autodates(),
      ],
      indexes: ["CREATE INDEX idx_ai_calls_user_created ON ai_calls (user, created)"],
    });
    app.save(aiCalls);

    // --- SQLite WAL (§2.3). PocketBase ouvre déjà ses connexions en WAL ; ce pragma le rend explicite
    // et persistant dans le fichier. busy_timeout est un réglage par connexion, non persistable ici :
    // PocketBase applique 10 000 ms, ce qui couvre l'exigence de 5 000 ms.
    app.db().newQuery("PRAGMA journal_mode=WAL").execute();

    // --- Sauvegardes quotidiennes (§2.3), 3 h du matin, 14 archives conservées
    const settings = app.settings();
    settings.backups.cron = "0 3 * * *";
    settings.backups.cronMaxKeep = 14;
    app.save(settings);
  },
  (app) => {
    for (const name of [
      "ai_calls",
      "generation_jobs",
      "pending_changes",
      "versions",
      "scenes",
      "chapters",
      "projects",
    ]) {
      app.delete(app.findCollectionByNameOrId(name));
    }
    const users = app.findCollectionByNameOrId("users");
    for (const f of ["role", "monthly_budget_usd", "accepted_terms_at"]) users.fields.removeByName(f);
    app.save(users);
  },
);
