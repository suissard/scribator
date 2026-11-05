import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { assembleBook, safeFilename, toDocx, toEpub, toMarkdown } from '../src/services/export.service.js';

const chapters = [
  { id: 'b', chapter_number: 2, title: 'Deux' },
  { id: 'a', chapter_number: 1, title: 'Un & demi' },
  { id: 'c', chapter_number: 3, title: 'Vide' },
] as any;
const scenes = new Map<string, any[]>([
  ['a', [
    { scene_number: 2, content: 'Suite *italique* et **gras**.', scene_break_before: true },
    { scene_number: 1, content: "- Bonjour, dit-elle.\n\n- Non <script>.", scene_break_before: false },
  ]],
  ['b', [{ scene_number: 1, content: 'Fin.', scene_break_before: false }]],
]);
const book = (notice = false) => assembleBook('Le Phare', 'fr', chapters, scenes, notice);

describe('export', () => {
  it('ordonne chapitres et scènes, ignore les chapitres vides', () => {
    const md = toMarkdown(book());
    expect(md.indexOf('Chapitre 1')).toBeLessThan(md.indexOf('Chapitre 2'));
    expect(md.indexOf('Bonjour')).toBeLessThan(md.indexOf('* * *'));
    expect(md).not.toContain('Vide');
  });

  it('ajoute la mention IA seulement sur demande', async () => {
    expect(toMarkdown(book())).not.toContain("assistance d'une IA");
    expect(toMarkdown(book(true))).toContain("assistance d'une IA");
  });

  it('produit un DOCX avec titres, italiques et saut de page', async () => {
    const zip = await JSZip.loadAsync(await toDocx(book()));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Heading1');
    expect(xml).toContain('<w:pageBreakBefore');
    expect(xml).toMatch(/<w:i\/>[\s\S]*?italique/);
    expect(xml).toMatch(/<w:b\/>[\s\S]*?gras/);
    expect(xml).toContain('w:val="both"'); // justifié
    expect(xml).toContain('- Bonjour, dit-elle.'); // un dialogue, pas une liste
    expect(xml).toContain('* * *');
  });

  it('produit un EPUB dont le XHTML est bien formé', async () => {
    const zip = await JSZip.loadAsync(await toEpub(book(true)));
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip');
    const names = Object.keys(zip.files).filter((n) => n.endsWith('.xhtml'));
    const all = (await Promise.all(names.map((n) => zip.file(n)!.async('string')))).join('');
    expect(all).toContain('italique');
    expect(all).toContain('Un &amp; demi');
    expect(all).not.toMatch(/<hr>|<br>/);
    expect(all).not.toContain('<script');
    expect(all).toContain('&lt;script&gt;');
  });

  it('nettoie le nom de fichier', () => {
    expect(safeFilename("L'Été / à Noël")).toBe('L_Ete_a_Noel');
    expect(safeFilename('///')).toBe('livre');
  });
});
