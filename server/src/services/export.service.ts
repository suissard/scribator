import {
  AlignmentType, Document, HeadingLevel, Packer, PageBreak, Paragraph, TextRun,
} from 'docx';
import { EPub } from 'epub-gen-memory';
import { Marked, type Token, type Tokens } from 'marked';
import type { ChapterRecord, SceneRecord } from '../types.js';
import { chapterText, sortChapters } from './memory.service.js';

export const AI_NOTICE = "Écrit avec l'assistance d'une IA.";
const FONT = 'Georgia';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Un dialogue « - Bonjour » n'est pas une liste : le découpage en listes est désactivé. */
const marked = new Marked({
  gfm: true,
  breaks: true,
  tokenizer: { list: () => undefined as never },
  // Un « <mot> » dans la prose est du texte : en XHTML, ce serait un élément inconnu et l'EPUB serait invalide.
  renderer: { html: ({ text }) => escapeHtml(text) },
});

export interface ExportChapter {
  chapter: Pick<ChapterRecord, 'chapter_number' | 'title'>;
  text: string;
}

export interface ExportBook {
  title: string;
  language: string;
  chapters: ExportChapter[];
  aiNotice: boolean;
}

export function assembleBook(
  title: string,
  language: string,
  chapters: ChapterRecord[],
  scenesByChapter: Map<string, SceneRecord[]>,
  aiNotice: boolean,
): ExportBook {
  return {
    title,
    language,
    aiNotice,
    chapters: sortChapters(chapters)
      .map((chapter) => ({ chapter, text: chapterText(scenesByChapter.get(chapter.id) ?? []) }))
      .filter((c) => c.text),
  };
}

const chapterHeading = (c: ExportChapter) => `Chapitre ${c.chapter.chapter_number} : ${c.chapter.title}`;

export function toMarkdown(book: ExportBook): string {
  const parts = [`# ${book.title}`];
  if (book.aiNotice) parts.push(`*${AI_NOTICE}*`);
  for (const c of book.chapters) parts.push(`## ${chapterHeading(c)}\n\n${c.text}`);
  return `${parts.join('\n\n')}\n`;
}

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
}

function inlineRuns(tokens: Token[] | undefined, style: InlineStyle = {}): TextRun[] {
  const runs: TextRun[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'strong':
        runs.push(...inlineRuns((token as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case 'em':
        runs.push(...inlineRuns((token as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case 'del':
        runs.push(...inlineRuns((token as Tokens.Del).tokens, { ...style, strike: true }));
        break;
      case 'br':
        runs.push(new TextRun({ break: 1 }));
        break;
      default: {
        const nested = (token as Tokens.Text).tokens;
        if (nested?.length) runs.push(...inlineRuns(nested, style));
        else runs.push(new TextRun({ text: decodeEntities((token as Tokens.Text).text ?? token.raw), font: FONT, ...style }));
      }
    }
  }
  return runs;
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const body = (children: TextRun[]) =>
  new Paragraph({ children, alignment: AlignmentType.JUSTIFIED, spacing: { after: 160, line: 320 } });

const centered = (text: string, opts: { italics?: boolean } = {}) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 200 },
    children: [new TextRun({ text, font: FONT, ...opts })],
  });

function markdownToParagraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const token of marked.lexer(text)) {
    switch (token.type) {
      case 'space':
        break;
      case 'hr':
        out.push(centered('* * *'));
        break;
      case 'heading':
      case 'paragraph':
        out.push(body(inlineRuns((token as Tokens.Paragraph).tokens)));
        break;
      case 'blockquote':
        for (const t of (token as Tokens.Blockquote).tokens) {
          if (t.type === 'paragraph') out.push(body(inlineRuns((t as Tokens.Paragraph).tokens, { italics: true })));
        }
        break;
      default:
        if (token.raw.trim()) out.push(body([new TextRun({ text: token.raw.trim(), font: FONT })]));
    }
  }
  return out;
}

export async function toDocx(book: ExportBook): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ spacing: { before: 3000 } }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: book.title, font: FONT, size: 56, bold: true })],
    }),
  ];
  if (book.aiNotice) children.push(new Paragraph({ children: [new PageBreak()] }), centered(AI_NOTICE, { italics: true }));
  for (const c of book.chapters) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        spacing: { after: 400 },
        children: [new TextRun({ text: chapterHeading(c), font: FONT, bold: true, size: 36, color: '000000' })],
      }),
      ...markdownToParagraphs(c.text),
    );
  }
  const doc = new Document({
    title: book.title,
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

const toXhtml = (html: string) => html.replace(/<(hr|br)\s*>/g, '<$1 />');

export async function toEpub(book: ExportBook): Promise<Buffer> {
  const content = book.chapters.map((c) => ({
    title: chapterHeading(c),
    content: toXhtml(marked.parse(c.text, { async: false })),
  }));
  if (book.aiNotice) {
    content.unshift({ title: 'Mention', content: `<p><em>${escapeHtml(AI_NOTICE)}</em></p>` });
  }
  const epub = new EPub(
    {
      title: book.title,
      lang: book.language || 'fr',
      tocTitle: 'Sommaire',
      ignoreFailedDownloads: true,
      css: 'body { font-family: serif; text-align: justify; } hr { border: 0; text-align: center; } hr::after { content: "* * *"; }',
    },
    content,
  );
  await epub.render();
  return epub.genEpub();
}

export const safeFilename = (title: string) =>
  title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'livre';
