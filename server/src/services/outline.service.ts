import type { AiOutline, AiScenePlan, ChapterRecord, SceneRecord } from '../types.js';
import { countWords } from './parser.service.js';

export const isLocked = (c: Pick<ChapterRecord, 'status' | 'user_edited_outline'>) =>
  c.status !== 'PENDING' || c.user_edited_outline;

export type NewChapter = Omit<AiOutline['chapters'][number], 'after_chapter_id'>;
export type OutlineSlot = { kind: 'existing'; id: string } | { kind: 'new'; chapter: NewChapter };

/** Insère les chapitres générés autour des chapitres verrouillés, puis l'ordre donne la numérotation. */
export function mergeOutline(
  lockedIds: string[],
  generated: AiOutline['chapters'],
  missingCount: number,
): OutlineSlot[] {
  const taken = generated.slice(0, Math.max(0, missingCount));
  const known = new Set(lockedIds);
  const toSlot = ({ after_chapter_id: _a, ...chapter }: AiOutline['chapters'][number]): OutlineSlot => ({ kind: 'new', chapter });
  const slots: OutlineSlot[] = taken.filter((c) => c.after_chapter_id === null).map(toSlot);
  for (const id of lockedIds) {
    slots.push({ kind: 'existing', id });
    slots.push(...taken.filter((c) => c.after_chapter_id === id).map(toSlot));
  }
  // Identifiant inventé par le modèle : le chapitre est conservé, en fin de livre.
  slots.push(...taken.filter((c) => c.after_chapter_id !== null && !known.has(c.after_chapter_id)).map(toSlot));
  return slots;
}

/** Réordonne les chapitres PENDING entre eux : les autres ne bougent pas (§4.3). */
export function reorderPending(
  chapters: Pick<ChapterRecord, 'id' | 'chapter_number' | 'status'>[],
  orderedPendingIds: string[],
): string[] | null {
  const sorted = [...chapters].sort((a, b) => a.chapter_number - b.chapter_number);
  const pending = sorted.filter((c) => c.status === 'PENDING').map((c) => c.id);
  const same = pending.length === orderedPendingIds.length && new Set([...pending, ...orderedPendingIds]).size === pending.length;
  if (!same) return null;
  const queue = [...orderedPendingIds];
  return sorted.map((c) => (c.status === 'PENDING' ? queue.shift()! : c.id));
}

export const defaultSceneCount = (targetWords: number) => Math.min(8, Math.max(1, Math.round(targetWords / 1100)));

/** Toutes les scènes sont écrites, mais le chapitre reste trop court : il lui en faut d'autres. */
export function needsPlanning(chapter: Pick<ChapterRecord, 'target_words'>, scenes: Array<Pick<SceneRecord, 'status' | 'content'>>): boolean {
  const written = scenes.reduce((n, s) => n + countWords(s.content), 0);
  return !scenes.some((s) => s.status === 'PENDING') && written < chapter.target_words * 0.8;
}

/** Écriture automatique : écrit mais non validé, donc à refaire. Avec des scènes à écrire, il reprend plutôt là où il s'est arrêté. */
export function needsRewrite(chapter: Pick<ChapterRecord, 'status'>, scenes: Array<Pick<SceneRecord, 'status'>>): boolean {
  return (chapter.status === 'REVIEW' || chapter.status === 'STALE') && !scenes.some((s) => s.status === 'PENDING');
}

/** Impose le nombre de scènes et ramène la somme des cibles sur l'objectif (§5.5). */
export function normalizeScenePlan(plan: AiScenePlan, expected: number, totalWords: number): AiScenePlan['scenes'] {
  const scenes = plan.scenes.slice(0, expected);
  const sum = scenes.reduce((n, s) => n + Math.max(0, s.target_words), 0);
  return scenes.map((s) => ({
    ...s,
    target_words: Math.max(50, Math.round(sum > 0 ? (s.target_words / sum) * totalWords : totalWords / scenes.length)),
  }));
}
