import { diffArrays } from 'diff';
import type { ChapterRecord, SceneRecord } from '../types.js';
import { countWords } from './parser.service.js';

/* ---------- Diff normalisé (§5.4) ---------- */

/** Retire la syntaxe Markdown et unifie la typographie : seuls les vrais changements de mots comptent. */
export function normalizeForDiff(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[*_-]\s*){3,}$/gm, ' ')
    .replace(/^\s*[*+]\s+/gm, '')
    .replace(/^\s*\d+\\?\.\s+/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/(?<!\\)(\*\*|__)(?=\S)([\s\S]*?[^\s\\])\1/g, '$2')
    .replace(/(?<![\p{L}\p{N}\\])(\*|_)(?=\S)([\s\S]*?[^\s\\])\1(?![\p{L}\p{N}])/gu, '$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[     ]/g, ' ')
    .replace(/[​﻿]/g, '')
    .replace(/[‘’‛ʼ]/g, "'")
    .replace(/[“”„«»"]/g, ' ') // les guillemets ne sont ni un mot ni un changement de style
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DiffResult {
  changedPercent: number;
  pairs: Array<{ before: string; after: string }>;
}

/** Pourcentage de mots changés : un mot remplacé compte pour un, pas pour deux. */
export function computeDiff(original: string, edited: string): DiffResult {
  const a = normalizeForDiff(original).split(' ').filter(Boolean);
  const b = normalizeForDiff(edited).split(' ').filter(Boolean);
  if (a.length === 0) return { changedPercent: b.length === 0 ? 0 : 100, pairs: [] };

  const parts = diffArrays(a, b);
  let removed = 0;
  let added = 0;
  const pairs: DiffResult['pairs'] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!part.added && !part.removed) continue;
    const next = parts[i + 1];
    const replaced = part.removed && next?.added;
    const before = part.removed ? part.value : [];
    const after = replaced ? next!.value : part.added ? part.value : [];
    removed += before.length;
    added += after.length;
    pairs.push({ before: before.join(' '), after: after.join(' ') });
    if (replaced) i++;
  }
  const changed = Math.max(removed, added);
  return { changedPercent: (changed / a.length) * 100, pairs };
}

export const STYLE_DIFF_THRESHOLD_PERCENT = 5;

/* ---------- Texte des chapitres ---------- */

export const sortChapters = <T extends { chapter_number: number }>(list: T[]) =>
  [...list].sort((x, y) => x.chapter_number - y.chapter_number);
export const sortScenes = <T extends { scene_number: number }>(list: T[]) =>
  [...list].sort((x, y) => x.scene_number - y.scene_number);

export function chapterText(scenes: Pick<SceneRecord, 'scene_number' | 'content' | 'scene_break_before'>[]): string {
  return sortScenes(scenes)
    .filter((s) => s.content.trim())
    .map((s, i) => (s.scene_break_before && i > 0 ? `* * *\n\n${s.content.trim()}` : s.content.trim()))
    .join('\n\n');
}

/* ---------- Mémoire adaptative (§7.2) ---------- */

export const estimateTokens = (words: number) => Math.ceil(words * 1.4);

export interface PreviousChapter {
  chapter_number: number;
  title: string;
  post_writing_summary: string;
  text: string;
}

export type MemoryMode = 'full' | 'summary';

export function chooseMemoryMode(previous: PreviousChapter[], tokenLimit: number): MemoryMode {
  const words = previous.reduce((n, c) => n + countWords(c.text), 0);
  return estimateTokens(words) < tokenLimit ? 'full' : 'summary';
}

/** Un synopsis invalidé n'a plus de texte : les résumés reprennent le relais tant qu'il n'est pas recalculé. */
export const effectiveCoverage = (archivedSynopsis: string, coversUpTo: number) =>
  archivedSynopsis.trim() ? coversUpTo : 0;

const heading = (c: PreviousChapter) => `### Chapitre ${c.chapter_number} : ${c.title}`;

export function buildMemoryBlock(
  previous: PreviousChapter[],
  mode: MemoryMode,
  synopsis: { text: string; coversUpTo: number },
): string {
  const sorted = sortChapters(previous);
  if (sorted.length === 0) return '';
  const full = (c: PreviousChapter) => `${heading(c)}\n\n${c.text}`;
  if (mode === 'full') return `## Chapitres précédents (texte intégral)\n\n${sorted.map(full).join('\n\n')}`;

  const covers = effectiveCoverage(synopsis.text, synopsis.coversUpTo);
  const lastTwo = sorted.slice(-2);
  const firstFull = lastTwo[0]!.chapter_number;
  const summaries = sorted.filter((c) => c.chapter_number > covers && c.chapter_number < firstFull);
  const parts: string[] = [];
  if (covers > 0) parts.push(`## Synopsis des chapitres 1 à ${covers}\n\n${synopsis.text.trim()}`);
  if (summaries.length > 0) {
    parts.push(
      `## Résumés des chapitres suivants\n\n${summaries.map((c) => `${heading(c)}\n\n${c.post_writing_summary.trim()}`).join('\n\n')}`,
    );
  }
  parts.push(`## Derniers chapitres (texte intégral)\n\n${lastTwo.map(full).join('\n\n')}`);
  return parts.join('\n\n');
}

/** Numéro du dernier chapitre à compresser, ou null si rien à faire (§5.8, étape 4). */
export function compressionTarget(
  approved: Pick<ChapterRecord, 'chapter_number' | 'post_writing_summary'>[],
  synopsis: { text: string; coversUpTo: number },
  compressWords: number,
): number | null {
  const sorted = sortChapters(approved);
  const last = sorted.at(-3)?.chapter_number; // on garde toujours les 2 derniers hors synopsis
  if (last === undefined) return null;
  const covers = effectiveCoverage(synopsis.text, synopsis.coversUpTo);
  const invalidated = synopsis.coversUpTo > 0 && covers === 0;
  const unarchived = sorted
    .filter((c) => c.chapter_number > covers)
    .reduce((n, c) => n + countWords(c.post_writing_summary), 0);
  return unarchived > compressWords || invalidated ? last : null;
}

/* ---------- Cohérence lors des retours en arrière (§4.3) ---------- */

export function chaptersToStale<T extends Pick<ChapterRecord, 'chapter_number' | 'status'>>(
  chapters: T[],
  reopened: number,
): T[] {
  return chapters.filter((c) => c.chapter_number > reopened && c.status === 'APPROVED');
}

export function invalidateSynopsis(
  coversUpTo: number,
  reopened: number,
): { archived_synopsis: string; synopsis_covers_up_to: number } | null {
  if (coversUpTo < reopened) return null;
  return { archived_synopsis: '', synopsis_covers_up_to: reopened - 1 };
}

/** §4.2 : tout chapitre a été validé, sans chapitre périmé. */
export const allApproved = (chapters: Pick<ChapterRecord, 'status'>[]) =>
  chapters.length > 0 && chapters.every((c) => c.status === 'APPROVED');
