import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  cleanText, countWords, detectFileKind, detectLanguage, extractRaw, parseReference, sampleSegments,
} from '../src/services/parser.service.js';

const words = (n: number, prefix = 'mot') => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');

describe('nettoyage', () => {
  it('retire les en-têtes et pieds de page répétés sur plus de 30 % des pages', () => {
    const pages = Array.from({ length: 10 }, (_, i) => `LE TITRE DU LIVRE\nTexte unique de la page ${'x'.repeat(i + 1)}\nÉditions Machin - page ${i + 1}`);
    const text = cleanText({ pages, paged: true });
    expect(text).not.toContain('LE TITRE DU LIVRE');
    expect(text).not.toContain('Éditions Machin');
    expect(text).toContain('Texte unique de la page xxx');
  });

  it('conserve une ligne présente sur une minorité de pages', () => {
    const pages = Array.from({ length: 10 }, (_, i) => `Corps ${'y'.repeat(i)}${i < 2 ? '\nLigne rare' : ''}`);
    expect(cleanText({ pages, paged: true })).toContain('Ligne rare');
  });

  it('retire numéros de page, copyright et table des matières', () => {
    const text = cleanText({
      pages: ['Table des matières\nChapitre 1 ........ 12\nChapitre 2 ........ 34\n© 2020 Gallimard\nISBN 978-2-07\n42\n- 43 -\nIl pleuvait sur Nantes.'],
      paged: false,
    });
    expect(text).toBe('Il pleuvait sur Nantes.');
  });

  it("n'ôte pas une phrase qui parle de droits", () => {
    expect(cleanText({ pages: ['Il réclamait ses droits devant le juge.'], paged: false })).toContain('réclamait');
  });
});

describe('échantillonnage', () => {
  it('prend 3 segments de 3 000 mots à 15, 50 et 85 % sur un livre long', () => {
    const segments = sampleSegments(words(100_000));
    expect(segments.map(countWords)).toEqual([3000, 3000, 3000]);
    expect(segments[0]).toContain('mot15000');
    expect(segments[1]).toContain('mot50000');
    expect(segments[2]).toContain('mot85000');
  });

  it('répartit sans chevauchement sur un livre court', () => {
    const segments = sampleSegments(words(6000));
    expect(segments.map(countWords)).toEqual([2000, 2000, 2000]);
    const seen = new Set(segments.flatMap((s) => s.split(' ')));
    expect(seen.size).toBe(6000);
  });

  it('ne chevauche pas à la limite de 12 000 mots', () => {
    const seen = new Set(sampleSegments(words(12_000)).flatMap((s) => s.split(' ')));
    expect(seen.size).toBe(9000);
  });

  it('refuse un texte de moins de 3 000 mots', () => {
    expect(() => sampleSegments(words(2999))).toThrow(/trop court/);
  });

  it('garde les paragraphes', () => {
    const text = Array.from({ length: 700 }, (_, i) => `Un deux trois quatre cinq ${i}.`).join('\n\n');
    expect(sampleSegments(text)[0]).toContain('\n\n');
  });
});

async function pdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([900, 1200]);
    text.match(/.{1,120}(\s|$)/g)?.forEach((line, i) => page.drawText(line.trim(), { x: 20, y: 1170 - i * 12, size: 9, font }));
  }
  return Buffer.from(await doc.save());
}

async function epub(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<package><manifest><item id="c2" href="b.xhtml"/><item id="c1" href="a.xhtml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>');
  zip.file('OEBPS/a.xhtml', `<html><head><title>x</title></head><body><p>Premier &amp; ${words(2000, 'a')}</p></body></html>`);
  zip.file('OEBPS/b.xhtml', `<html><body><p>Second ${words(2000, 'b')}</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('formats', () => {
  it('reconnaît le type par signature, pas par extension', async () => {
    expect(await detectFileKind(await pdf(['a']))).toBe('pdf');
    expect(await detectFileKind(await epub())).toBe('epub');
    expect(await detectFileKind(Buffer.from('Bonjour le monde'))).toBe('txt');
    await expect(detectFileKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).rejects.toThrow(/non pris en charge/);
  });

  it('lit un PDF texte', async () => {
    const letters = (n: number) => n.toString(26).replace(/\d/g, (d) => 'qrstuvwxyz'[Number(d)]!);
    const page = (_: unknown, p: number) => Array.from({ length: 400 }, (_, i) => `m${letters(p * 400 + i)}`).join(' ');
    const parsed = await parseReference(await pdf(Array.from({ length: 12 }, page)));
    expect(parsed.wordCount).toBeGreaterThan(3000);
  });

  it('détecte un PDF probablement scanné', async () => {
    await expect(extractRaw(await pdf(['Quelques mots', 'Et encore']), 'pdf')).rejects.toThrow(/scan/);
  });

  it("lit un EPUB dans l'ordre du spine", async () => {
    const { pages } = await extractRaw(await epub(), 'epub');
    expect(pages[0]).toContain('Premier & a0');
    expect(pages[1]).toContain('Second');
    expect(pages[0]).not.toContain('<p>');
  });

  it('lit un DOCX', async () => {
    const { Document, Packer, Paragraph } = await import('docx');
    const paragraphs = Array.from({ length: 50 }, (_, i) => new Paragraph(`Paragraphe ${i} ${words(100, 'd')}`));
    const buf = await Packer.toBuffer(new Document({ sections: [{ children: paragraphs }] }));
    expect(await detectFileKind(buf)).toBe('docx');
    expect((await parseReference(buf)).wordCount).toBeGreaterThan(5000);
  });

  it('lit un TXT en Windows-1252', async () => {
    const { pages } = await extractRaw(Buffer.from([0x63, 0x61, 0x66, 0xe9]), 'txt');
    expect(pages[0]).toBe('café');
  });

  it('détecte la langue', () => {
    expect(detectLanguage('Il était une fois une fille qui ne voulait pas dormir dans la maison et elle est partie')).toBe('fr');
    expect(detectLanguage('She said that he was not with her and the dog had gone for a walk but he')).toBe('en');
  });
});
