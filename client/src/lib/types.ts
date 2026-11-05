export type ProjectStatus =
  | 'STEP_1_INPUT' | 'STEP_2_CONCEPT_REVIEW' | 'STEP_3_OUTLINE_REVIEW' | 'STEP_4_SAMPLE_REVIEW' | 'STEP_5_WRITING' | 'COMPLETED';

export const STATUS_ORDER: ProjectStatus[] = [
  'STEP_1_INPUT', 'STEP_2_CONCEPT_REVIEW', 'STEP_3_OUTLINE_REVIEW', 'STEP_4_SAMPLE_REVIEW', 'STEP_5_WRITING', 'COMPLETED',
];

export type LengthPreset = 'NOUVELLE' | 'NOVELLA' | 'ROMAN' | 'ROMAN_LONG' | 'CUSTOM';

export interface StyleMatrix {
  tone: string; pacing: string; vocabulary_level: string; narrative_pov: string; tense: string;
  sentence_structure: string; dialogue_style: string;
  stylistic_rules: string[]; forbidden_tropes: string[]; forbidden_phrases: string[];
}

export interface StoryBible {
  characters: Array<{ id: string; name: string; role: 'principal' | 'secondaire' | 'figurant'; traits: string; current_status: string }>;
  locations: Array<{ id: string; name: string; description: string }>;
  world_rules: Array<{ id: string; rule: string }>;
  timeline_events: Array<{ id: string; chapter_number: number; event: string }>;
}

export interface Project {
  id: string; user: string; title: string; language: string; genre: string; audience: string;
  status: ProjectStatus; length_preset: LengthPreset; target_chapter_count: number; target_words_per_chapter: number;
  reference_file: string;
  reference_meta: { filename: string; word_count: number; language: string; analyzed_at: string } | null;
  raw_ideas: string; model_creative: string; style_matrix: StyleMatrix | null; story_bible: StoryBible | null;
  reformulated_concept: string; sample_text: string; sample_ai_original: string; sample_draft: string;
  updated: string;
}

export interface ModelOption {
  id: string; name: string; input_per_million: number; output_per_million: number; context_length: number; free: boolean;
}

export type ChapterStatus = 'PENDING' | 'PLANNED' | 'GENERATING' | 'REVIEW' | 'APPROVED' | 'STALE' | 'ERROR';

export interface Chapter {
  id: string; project: string; chapter_number: number; title: string; brief_summary: string; key_events: string[] | null;
  target_words: number; user_edited_outline: boolean; status: ChapterStatus; post_writing_summary: string; stale_reason: string;
}

export interface Scene {
  id: string; chapter: string; scene_number: number; beat: string; target_words: number; content: string; draft: string;
  status: 'PENDING' | 'GENERATING' | 'REVIEW' | 'APPROVED'; scene_break_before: boolean; truncated: boolean;
}

export interface Job {
  id: string; project: string; kind: 'ANALYZE' | 'SAMPLE' | 'CHAPTER' | 'SCENE'; target_id: string;
  status: 'RUNNING' | 'DONE' | 'CANCELLED' | 'FAILED'; progress: { current: number; total: number } | null;
  error_message: string; created: string;
}

export interface PendingChange {
  id: string; project: string; kind: 'BIBLE_PATCH' | 'STYLE_SUGGESTION'; source_chapter: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  payload: BiblePatchPayload | StyleSuggestionPayload;
}

export interface BiblePatchPayload {
  operations: Array<
    | { op: 'add'; section: string; item: Record<string, unknown> }
    | { op: 'update'; section: string; id: string; fields: Record<string, string> }
    | { op: 'remove'; section: string; id: string; reason: string }
  >;
}

export interface StyleSuggestionPayload {
  explanation: string;
  changes: Partial<StyleMatrix>;
  evidence: Array<{ before: string; after: string }>;
}

export interface Version {
  id: string; target_id: string; field: string; content: string; reason: string; created: string;
}

export const LENGTH_PRESETS: Array<{ id: Exclude<LengthPreset, 'CUSTOM'>; label: string; total: string; chapters: number; words: number }> = [
  { id: 'NOUVELLE', label: 'Nouvelle', total: '5 000 à 15 000 mots', chapters: 4, words: 2000 },
  { id: 'NOVELLA', label: 'Novella', total: '20 000 à 40 000 mots', chapters: 10, words: 3000 },
  { id: 'ROMAN', label: 'Roman', total: '60 000 à 90 000 mots', chapters: 20, words: 3500 },
  { id: 'ROMAN_LONG', label: 'Roman long', total: '100 000 mots et plus', chapters: 30, words: 4000 },
];
