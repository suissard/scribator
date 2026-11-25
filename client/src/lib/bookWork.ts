import type { Chapter } from './types';

/**
 * « Tout écrire » est proposé une fois le premier chapitre validé (il sert d'échantillon),
 * s'il reste au moins un chapitre à rédiger, et jamais pour un livre d'un seul chapitre.
 */
export function canWriteAll(chapters: Pick<Chapter, 'status'>[]): boolean {
  return (
    chapters.length > 1 &&
    chapters[0]?.status === 'APPROVED' &&
    chapters.some((c) => c.status === 'PENDING' || c.status === 'PLANNED' || c.status === 'ERROR')
  );
}
