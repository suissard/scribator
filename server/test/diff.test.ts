import { describe, expect, it } from 'vitest';
import { computeDiff, normalizeForDiff } from '../src/services/memory.service.js';

describe('normalisation plain-text', () => {
  it('neutralise les reformatages typiques de TipTap', () => {
    const ai = `Il dit : "L'aube viendra" - puis se tut...\n\n*Vraiment ?* **Non.**\n\n- Bonjour, fit-elle.\n\n* * *\n\nFin.`;
    const tiptap = `Il dit : « L’aube viendra » — puis se tut…\n\n_Vraiment ?_ __Non.__\n\n\\- Bonjour, fit-elle.\n\n---\n\nFin.`;
    expect(normalizeForDiff(tiptap).replace(/^- /m, '')).toBe(normalizeForDiff(ai).replace(/^- /m, ''));
    expect(computeDiff(ai, tiptap).changedPercent).toBe(0);
  });

  it('donne 0 % sur la sortie réelle de TipTap (relevée dans le navigateur)', () => {
    const ai = `3 * 4 faisaient douze.\n\n* * *\n\nAvec ses [crochets] & ses <balises>.`;
    const tiptap = `3 \\* 4 faisaient douze.\n\n---\n\nAvec ses \\[crochets\\] & ses &lt;balises&gt;.`;
    expect(computeDiff(ai, tiptap).changedPercent).toBe(0);
  });

  it('retire titres, citations, liens et échappements', () => {
    expect(normalizeForDiff('# Titre\n\n> Citation\n\n[lien](http://x.y) \\*étoile\\*')).toBe('Titre Citation lien *étoile*');
  });

  it('conserve les astérisques isolés et les mots avec underscore', () => {
    expect(normalizeForDiff('nom_de_code et 3 * 4')).toBe('nom_de_code et 3 * 4');
  });
});

describe('pourcentage de changement', () => {
  const base = Array.from({ length: 100 }, (_, i) => `mot${i}`);

  it('vaut 0 pour un texte identique', () => {
    expect(computeDiff(base.join(' '), base.join(' ')).changedPercent).toBe(0);
  });

  it('compte un mot remplacé une seule fois', () => {
    const edited = [...base];
    edited[10] = 'autre';
    expect(computeDiff(base.join(' '), edited.join(' ')).changedPercent).toBe(1);
  });

  it('compte exactement les suppressions et les ajouts', () => {
    expect(computeDiff(base.join(' '), base.slice(0, 90).join(' ')).changedPercent).toBe(10);
    expect(computeDiff(base.join(' '), [...base, 'a', 'b', 'c'].join(' ')).changedPercent).toBe(3);
  });

  it('gère un original vide', () => {
    expect(computeDiff('', '').changedPercent).toBe(0);
    expect(computeDiff('', 'nouveau').changedPercent).toBe(100);
  });

  it('fournit les paires avant/après', () => {
    expect(computeDiff('il marcha lentement vers la mer', 'il marcha vers la mer').pairs).toEqual([{ before: 'lentement', after: '' }]);
  });
});
