import type { Chapter } from './types';

/**
 * « Tout écrire » refait les chapitres en attente de relecture : il ne sert que s'il reste au moins
 * un chapitre à rédiger, et jamais pour un livre d'un seul chapitre (le bouton du chapitre suffit).
 */
export function canWriteAll(chapters: Pick<Chapter, 'status'>[]): boolean {
  return chapters.length > 1 && chapters.some((c) => c.status === 'PENDING' || c.status === 'PLANNED' || c.status === 'ERROR');
}
