import { renderTemplate } from '../lib/prompts.js';
import type { ChapterRecord, StoryBible, StyleMatrix } from '../types.js';
import { buildMemoryBlock, chooseMemoryMode, sortChapters, type MemoryMode, type PreviousChapter } from './memory.service.js';

/* Toutes les fonctions de ce fichier sont pures : à entrée identique, sortie identique à l'octet près.
 * C'est la condition du prompt caching (§7.3). Pas de date, pas d'identifiant, pas de JSON.stringify. */

const bullets = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- (aucun)');

export function formatStyleMatrix(s: StyleMatrix): string {
  return [
    `- Ton : ${s.tone}`,
    `- Rythme : ${s.pacing}`,
    `- Niveau de vocabulaire : ${s.vocabulary_level}`,
    `- Point de vue narratif : ${s.narrative_pov}`,
    `- Temps du récit : ${s.tense}`,
    `- Structure des phrases : ${s.sentence_structure}`,
    `- Style des dialogues : ${s.dialogue_style}`,
    '',
    '### Règles stylistiques',
    bullets(s.stylistic_rules),
    '',
    '### Tropes interdits',
    bullets(s.forbidden_tropes),
    '',
    '### Expressions interdites',
    bullets(s.forbidden_phrases),
  ].join('\n');
}

export function formatBible(b: StoryBible): string {
  const timeline = [...b.timeline_events].sort(
    (x, y) => x.chapter_number - y.chapter_number || x.id.localeCompare(y.id),
  );
  return [
    '### Personnages',
    bullets(b.characters.map((c) => `**${c.name}** (${c.role}) : ${c.traits}. État actuel : ${c.current_status}`)),
    '',
    '### Lieux',
    bullets(b.locations.map((l) => `**${l.name}** : ${l.description}`)),
    '',
    '### Règles du monde',
    bullets(b.world_rules.map((r) => r.rule)),
    '',
    '### Chronologie',
    bullets(timeline.map((e) => `Chapitre ${e.chapter_number} : ${e.event}`)),
  ].join('\n');
}

/** Variante avec les identifiants, pour que le modèle puisse cibler une entité dans un patch. */
export function formatBibleWithIds(b: StoryBible): string {
  return [
    '### Personnages',
    bullets(b.characters.map((c) => `[${c.id}] ${c.name} (${c.role}) : ${c.traits}. État : ${c.current_status}`)),
    '',
    '### Lieux',
    bullets(b.locations.map((l) => `[${l.id}] ${l.name} : ${l.description}`)),
    '',
    '### Règles du monde',
    bullets(b.world_rules.map((r) => `[${r.id}] ${r.rule}`)),
    '',
    '### Chronologie',
    bullets(b.timeline_events.map((e) => `[${e.id}] Chapitre ${e.chapter_number} : ${e.event}`)),
  ].join('\n');
}

export type OutlineChapter = Pick<ChapterRecord, 'chapter_number' | 'title' | 'brief_summary'>;

export const formatOutline = (chapters: OutlineChapter[]) =>
  sortChapters(chapters)
    .map((c) => `${c.chapter_number}. **${c.title}** : ${c.brief_summary}`)
    .join('\n');

export interface TextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

const cached = (text: string): TextBlock => ({ type: 'text', text, cache_control: { type: 'ephemeral' } });

export interface ProjectContext {
  language: string;
  genre: string;
  audience: string;
  style_matrix: StyleMatrix;
  story_bible: StoryBible;
  reformulated_concept: string;
  archived_synopsis: string;
  synopsis_covers_up_to: number;
}

function systemBlock(template: string, p: ProjectContext, sample: string): string {
  return renderTemplate(template, {
    language: p.language,
    genre: p.genre,
    audience: p.audience,
    style_matrix: formatStyleMatrix(p.style_matrix),
    sample_text: sample,
  });
}

function globalBlock(p: ProjectContext, outline: OutlineChapter[]): string {
  return [
    '# Contexte global de l\'œuvre',
    '## Concept',
    p.reformulated_concept.trim(),
    '## Trame complète',
    formatOutline(outline),
    '## Bible de l\'histoire',
    formatBible(p.story_bible),
  ].join('\n\n');
}

export interface SceneContextInput {
  templates: { system: string; objective: string };
  project: ProjectContext;
  sampleText: string;
  outline: OutlineChapter[];
  previousChapters: PreviousChapter[];
  memoryTokenLimit: number;
  chapter: Pick<ChapterRecord, 'chapter_number' | 'title' | 'brief_summary' | 'key_events'>;
  writtenScenes: string[];
  scene: { beat: string; target_words: number };
  instructions?: string;
}

export interface BuiltContext {
  system: TextBlock[];
  user: string;
  memoryMode: MemoryMode;
}

export function buildSceneContext(input: SceneContextInput): BuiltContext {
  const { project: p, chapter, scene } = input;
  const memoryMode = chooseMemoryMode(input.previousChapters, input.memoryTokenLimit);
  const memory = buildMemoryBlock(input.previousChapters, memoryMode, {
    text: p.archived_synopsis,
    coversUpTo: p.synopsis_covers_up_to,
  });

  const system = [cached(systemBlock(input.templates.system, p, input.sampleText)), cached(globalBlock(p, input.outline))];
  if (memory) system.push(cached(`# Mémoire du livre\n\n${memory}`)); // un bloc vide serait refusé par l'API

  const written = input.writtenScenes.length
    ? `# Scènes déjà écrites de ce chapitre\n\n${input.writtenScenes.join('\n\n')}\n\n`
    : '';
  const user =
    written +
    renderTemplate(input.templates.objective, {
      chapter_number: chapter.chapter_number,
      chapter_title: chapter.title,
      chapter_summary: chapter.brief_summary,
      key_events: bullets(chapter.key_events ?? []),
      beat: scene.beat,
      target_words: scene.target_words,
      instructions: input.instructions?.trim()
        ? `\n\n## Instructions de l'auteur pour cette version\n\n${input.instructions.trim()}`
        : '',
    });
  return { system, user, memoryMode };
}

export interface SampleContextInput {
  templates: { system: string; objective: string };
  project: ProjectContext;
  outline: OutlineChapter[];
  chapter: Pick<ChapterRecord, 'title' | 'brief_summary' | 'key_events'>;
}

/** L'échantillon n'a ni mémoire ni texte de référence : c'est lui qui deviendra cette référence. */
export function buildSampleContext(input: SampleContextInput): { system: TextBlock[]; user: string } {
  const { project: p, chapter } = input;
  const noReference = '(Aucun texte validé pour l\'instant : le passage demandé deviendra cette référence.)';
  return {
    system: [cached(systemBlock(input.templates.system, p, noReference)), cached(globalBlock(p, input.outline))],
    user: renderTemplate(input.templates.objective, {
      chapter_title: chapter.title,
      chapter_summary: chapter.brief_summary,
      key_events: bullets(chapter.key_events ?? []),
    }),
  };
}
