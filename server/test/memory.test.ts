import { describe, expect, it } from 'vitest';
import {
  allApproved, buildMemoryBlock, chaptersToStale, chapterText, chooseMemoryMode, compressionTarget, effectiveCoverage, estimateTokens, invalidateSynopsis,
  type PreviousChapter,
} from '../src/services/memory.service.js';

const chap = (n: number, status: any) => ({ id: `c${n}`, chapter_number: n, status });
const prev = (n: number, words = 10): PreviousChapter => ({
  chapter_number: n, title: `T${n}`, post_writing_summary: `Résumé ${n}`, text: `Texte${n} `.repeat(words).trim(),
});

describe('propagation de STALE', () => {
  it('rouvrir le chapitre 2 périme seulement les chapitres suivants déjà validés', () => {
    const chapters = [chap(1, 'APPROVED'), chap(2, 'REVIEW'), chap(3, 'APPROVED'), chap(4, 'APPROVED'), chap(5, 'PENDING')];
    expect(chaptersToStale(chapters, 2).map((c) => c.id)).toEqual(['c3', 'c4']);
  });
  it('ne touche ni aux chapitres en cours ni aux précédents', () => {
    expect(chaptersToStale([chap(1, 'APPROVED'), chap(3, 'REVIEW')], 2)).toEqual([]);
  });
  it('un chapitre STALE empêche COMPLETED', () => {
    expect(allApproved([{ status: 'APPROVED' }, { status: 'STALE' }])).toBe(false);
    expect(allApproved([{ status: 'APPROVED' }])).toBe(true);
    expect(allApproved([])).toBe(false);
  });
});

describe('invalidation du synopsis', () => {
  it('invalide si le synopsis couvre le chapitre rouvert', () => {
    expect(invalidateSynopsis(5, 3)).toEqual({ archived_synopsis: '', synopsis_covers_up_to: 2 });
    expect(invalidateSynopsis(3, 3)).toEqual({ archived_synopsis: '', synopsis_covers_up_to: 2 });
  });
  it('ne fait rien sinon', () => {
    expect(invalidateSynopsis(2, 3)).toBeNull();
    expect(invalidateSynopsis(0, 1)).toBeNull();
  });
  it('sans texte, les résumés remplacent le synopsis invalidé', () => {
    expect(effectiveCoverage('', 4)).toBe(0);
    const block = buildMemoryBlock([prev(1), prev(2), prev(3), prev(4)], 'summary', { text: '', coversUpTo: 2 });
    expect(block).toContain('Résumé 1');
    expect(block).not.toContain('Synopsis');
  });
  it('déclenche le recalcul à la validation suivante', () => {
    const list = [1, 2, 3, 4, 5].map((n) => ({ chapter_number: n, post_writing_summary: 'court' }));
    expect(compressionTarget(list, { text: '', coversUpTo: 2 }, 3000)).toBe(3);
  });
});

describe('mémoire adaptative', () => {
  it('reste en intégral sous la limite estimée à 1,4 token par mot', () => {
    expect(estimateTokens(1000)).toBe(1400);
    expect(chooseMemoryMode([prev(1, 70)], 100)).toBe('full');
    expect(chooseMemoryMode([prev(1, 72)], 100)).toBe('summary');
  });

  it('en mode résumés : synopsis, résumés, puis 2 derniers chapitres en intégral', () => {
    const block = buildMemoryBlock([1, 2, 3, 4, 5, 6].map((n) => prev(n)), 'summary', { text: 'SYNOPSIS', coversUpTo: 2 });
    expect(block.indexOf('SYNOPSIS')).toBeLessThan(block.indexOf('Résumé 3'));
    expect(block.indexOf('Résumé 4')).toBeLessThan(block.indexOf('Texte5'));
    expect(block).toContain('Texte6');
    expect(block).not.toContain('Résumé 1');
    expect(block).not.toContain('Résumé 5');
    expect(block).not.toContain('Texte4');
  });

  it('compresse seulement au-delà du seuil, en gardant les 2 derniers', () => {
    const long = 'mot '.repeat(1000);
    const list = [1, 2, 3, 4].map((n) => ({ chapter_number: n, post_writing_summary: long }));
    expect(compressionTarget(list, { text: '', coversUpTo: 0 }, 3000)).toBe(2);
    expect(compressionTarget(list, { text: '', coversUpTo: 0 }, 5000)).toBeNull();
    expect(compressionTarget(list.slice(0, 2), { text: '', coversUpTo: 0 }, 10)).toBeNull();
  });
});

describe('texte de chapitre', () => {
  it('concatène dans l’ordre avec les séparateurs de scène', () => {
    const scenes = [
      { scene_number: 2, content: 'B', scene_break_before: true },
      { scene_number: 1, content: 'A', scene_break_before: true },
    ];
    expect(chapterText(scenes)).toBe('A\n\n* * *\n\nB');
  });
});
