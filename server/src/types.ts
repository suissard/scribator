import { z } from 'zod';

export const StyleMatrixSchema = z.object({
  tone: z.string(),
  pacing: z.string(),
  vocabulary_level: z.string(),
  narrative_pov: z.string(),
  tense: z.string(),
  sentence_structure: z.string(),
  dialogue_style: z.string(),
  stylistic_rules: z.array(z.string()),
  forbidden_tropes: z.array(z.string()),
  forbidden_phrases: z.array(z.string()),
});
export type StyleMatrix = z.infer<typeof StyleMatrixSchema>;

const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['principal', 'secondaire', 'figurant']),
  traits: z.string(),
  current_status: z.string(),
});
const LocationSchema = z.object({ id: z.string(), name: z.string(), description: z.string() });
const WorldRuleSchema = z.object({ id: z.string(), rule: z.string() });
const TimelineEventSchema = z.object({ id: z.string(), chapter_number: z.number().int(), event: z.string() });

export const StoryBibleSchema = z.object({
  characters: z.array(CharacterSchema),
  locations: z.array(LocationSchema),
  world_rules: z.array(WorldRuleSchema),
  timeline_events: z.array(TimelineEventSchema),
});
export type StoryBible = z.infer<typeof StoryBibleSchema>;

export const BIBLE_SECTIONS = ['characters', 'locations', 'world_rules', 'timeline_events'] as const;
export type BibleSection = (typeof BIBLE_SECTIONS)[number];

export const BiblePatchSchema = z.object({
  operations: z.array(
    z.discriminatedUnion('op', [
      z.object({ op: z.literal('add'), section: z.enum(BIBLE_SECTIONS), item: z.record(z.string(), z.unknown()) }),
      z.object({
        op: z.literal('update'),
        section: z.enum(BIBLE_SECTIONS),
        id: z.string(),
        fields: z.record(z.string(), z.string()),
      }),
      z.object({ op: z.literal('remove'), section: z.enum(BIBLE_SECTIONS), id: z.string(), reason: z.string() }),
    ]),
  ),
});
export type BiblePatch = z.infer<typeof BiblePatchSchema>;

export const StyleSuggestionSchema = z.object({
  explanation: z.string(),
  changes: StyleMatrixSchema.partial(),
  evidence: z.array(z.object({ before: z.string(), after: z.string() })),
});
export type StyleSuggestion = z.infer<typeof StyleSuggestionSchema>;

/* ---- Formes demandées au modèle ----
 * Les sorties structurées n'acceptent ni z.record ni z.unknown : ces schémas restent plats,
 * puis sont convertis vers les types métier ci-dessus. */

export const AiBibleSchema = z.object({
  characters: z.array(CharacterSchema.omit({ id: true })),
  locations: z.array(LocationSchema.omit({ id: true })),
  world_rules: z.array(WorldRuleSchema.omit({ id: true })),
  timeline_events: z.array(TimelineEventSchema.omit({ id: true })),
});

export const AiConceptSchema = z.object({ reformulated_concept: z.string(), story_bible: AiBibleSchema });

export const AiOutlineSchema = z.object({
  chapters: z.array(
    z.object({
      title: z.string(),
      brief_summary: z.string(),
      key_events: z.array(z.string()),
      after_chapter_id: z.string().nullable(),
    }),
  ),
});
export type AiOutline = z.infer<typeof AiOutlineSchema>;

export const AiScenePlanSchema = z.object({
  scenes: z.array(z.object({ beat: z.string(), target_words: z.number().int(), scene_break_before: z.boolean() })),
});
export type AiScenePlan = z.infer<typeof AiScenePlanSchema>;

export const AiBiblePatchSchema = z.object({
  add: AiBibleSchema,
  updates: z.array(
    z.object({ section: z.enum(BIBLE_SECTIONS), id: z.string(), field: z.string(), value: z.string() }),
  ),
  removals: z.array(z.object({ section: z.enum(BIBLE_SECTIONS), id: z.string(), reason: z.string() })),
});
export type AiBiblePatch = z.infer<typeof AiBiblePatchSchema>;

export const AiChapterMemorySchema = z.object({ post_writing_summary: z.string(), bible_patch: AiBiblePatchSchema });

export const AiStyleLearningSchema = z.object({
  explanation: z.string(),
  changes: z.object({
    tone: z.string().nullable(),
    pacing: z.string().nullable(),
    vocabulary_level: z.string().nullable(),
    sentence_structure: z.string().nullable(),
    dialogue_style: z.string().nullable(),
    stylistic_rules: z.array(z.string()),
    forbidden_tropes: z.array(z.string()),
    forbidden_phrases: z.array(z.string()),
  }),
  evidence: z.array(z.object({ before: z.string(), after: z.string() })),
});
export type AiStyleLearning = z.infer<typeof AiStyleLearningSchema>;

export const AiSynopsisSchema = z.object({ synopsis: z.string() });

/* ---- Enregistrements PocketBase ---- */

export type ProjectStatus =
  | 'STEP_1_INPUT'
  | 'STEP_2_CONCEPT_REVIEW'
  | 'STEP_3_OUTLINE_REVIEW'
  | 'STEP_4_SAMPLE_REVIEW'
  | 'STEP_5_WRITING'
  | 'COMPLETED';

export const STATUS_ORDER: ProjectStatus[] = [
  'STEP_1_INPUT',
  'STEP_2_CONCEPT_REVIEW',
  'STEP_3_OUTLINE_REVIEW',
  'STEP_4_SAMPLE_REVIEW',
  'STEP_5_WRITING',
  'COMPLETED',
];

export interface ProjectRecord {
  id: string;
  user: string;
  title: string;
  language: string;
  genre: string;
  audience: string;
  status: ProjectStatus;
  length_preset: string;
  target_chapter_count: number;
  target_words_per_chapter: number;
  reference_file: string;
  reference_meta: unknown;
  raw_ideas: string;
  model_creative: string;
  style_matrix: StyleMatrix | null;
  story_bible: StoryBible | null;
  reformulated_concept: string;
  sample_text: string;
  sample_ai_original: string;
  sample_draft: string;
  archived_synopsis: string;
  synopsis_covers_up_to: number;
}

export type ChapterStatus = 'PENDING' | 'PLANNED' | 'GENERATING' | 'REVIEW' | 'APPROVED' | 'STALE' | 'ERROR';

export interface ChapterRecord {
  id: string;
  project: string;
  chapter_number: number;
  title: string;
  brief_summary: string;
  key_events: string[] | null;
  target_words: number;
  user_edited_outline: boolean;
  status: ChapterStatus;
  post_writing_summary: string;
  stale_reason: string;
  approved_at: string;
}

export type SceneStatus = 'PENDING' | 'GENERATING' | 'REVIEW' | 'APPROVED';

export interface SceneRecord {
  id: string;
  chapter: string;
  scene_number: number;
  beat: string;
  target_words: number;
  content: string;
  ai_original_content: string;
  draft: string;
  status: SceneStatus;
  scene_break_before: boolean;
  truncated: boolean;
}

export interface JobRecord {
  id: string;
  user: string;
  project: string;
  kind: 'ANALYZE' | 'SAMPLE' | 'CHAPTER' | 'SCENE' | 'BOOK';
  target_id: string;
  status: 'RUNNING' | 'DONE' | 'CANCELLED' | 'FAILED';
  cancel_requested: boolean;
  started_at: string;
}

export interface VersionRecord {
  id: string;
  project: string;
  target_collection: 'projects' | 'scenes';
  target_id: string;
  field: 'sample_text' | 'content' | 'reformulated_concept' | 'style_matrix' | 'story_bible';
  content: string;
  reason: 'before_regenerate' | 'before_restore' | 'before_patch';
}

export interface PendingChangeRecord {
  id: string;
  project: string;
  kind: 'BIBLE_PATCH' | 'STYLE_SUGGESTION';
  source_chapter: string;
  payload: unknown;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}
