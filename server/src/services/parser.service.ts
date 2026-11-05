import JSZip from 'jszip';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { AppError, badRequest } from '../lib/errors.js';

export type FileKind = 'pdf' | 'docx' | 'epub' | 'txt';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MIN_WORDS_PER_PDF_PAGE = 200;
const MIN_WORDS = 3000;
const SEGMENT_WORDS = 3000;
const FULL_SEGMENTS_THRESHOLD = 12_000;

/** Type réel du fichier, déduit de sa signature binaire et jamais de son extension. */
export async function detectFileKind(buf: Buffer): Promise<FileKind> {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const zip = await JSZip.loadAsync(buf).catch(() => null);
    if (zip?.file('word/document.xml')) return 'docx';
    const mimetype = await zip?.file('mimetype')?.async('string');
    if (mimetype?.trim() === 'application/epub+zip' || zip?.file('META-INF/container.xml')) return 'epub';
    throw unsupported();
  }
  if (isProbablyText(buf)) return 'txt';
  throw unsupported();
}

const unsupported = () => badRequest('Format non pris en charge : dépose un fichier PDF, DOCX, EPUB ou TXT.');

function isProbablyText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  if (sample.length === 0) return false;
  let control = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return control / sample.length < 0.02;
}

export const countWords = (text: string): number => text.match(/\S+/g)?.length ?? 0;

export interface Extracted {
  pages: string[]; // une entrée par page, ou un seul bloc si le format n'a pas de pages
  paged: boolean;
}

export async function extractRaw(buf: Buffer, kind: FileKind): Promise<Extracted> {
  switch (kind) {
    case 'pdf': {
      const { text } = await extractText(new Uint8Array(buf), { mergePages: false });
      const words = text.reduce((n, p) => n + countWords(p), 0);
      if (text.length > 0 && words / text.length < MIN_WORDS_PER_PDF_PAGE) {
        throw new AppError(
          422,
          'scanned_pdf',
          `Ce PDF ne contient presque pas de texte (${Math.round(words / text.length)} mots par page) : c'est probablement un scan. Utilise un PDF avec du texte sélectionnable, ou un DOCX, EPUB ou TXT.`,
        );
      }
      return { pages: text, paged: true };
    }
    case 'docx': {
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return { pages: [value], paged: false };
    }
    case 'epub':
      return { pages: await extractEpub(buf), paged: false };
    case 'txt':
      return { pages: [decodeText(buf)], paged: false };
  }
}

function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

async function extractEpub(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  const opf = opfPath ? await zip.file(opfPath)?.async('string') : undefined;
  if (!opfPath || !opf) throw badRequest('EPUB illisible : structure interne invalide.');

  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map<string, string>();
  for (const tag of opf.match(/<(?:\w+:)?item\s[^>]*>/g) ?? []) {
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    if (id && href) manifest.set(id, decodeURIComponent(href));
  }
  const parts: string[] = [];
  for (const tag of opf.match(/<(?:\w+:)?itemref\s[^>]*>/g) ?? []) {
    const href = manifest.get(tag.match(/\bidref="([^"]+)"/)?.[1] ?? '');
    const html = href ? await zip.file(base + href)?.async('string') : undefined;
    if (html) parts.push(htmlToText(html));
  }
  return parts;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  hellip: '…', mdash: '—', ndash: '–', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
};

function htmlToText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, n: string) => ENTITIES[n] ?? m);
}

const PAGE_NUMBER = /^\s*[-–—]?\s*(?:page\s+)?\d{1,4}(?:\s*(?:\/|sur|of)\s*\d{1,4})?\s*[-–—]?\s*$/i;
const ROMAN_PAGE = /^\s*[ivxlc]{1,6}\s*$/i;
const COPYRIGHT = /©|\(c\)\s*\d{4}|\bcopyright\b|\bisbn\b|tous droits réservés|all rights reserved|dépôt légal|imprimé en |printed in /i;
const TOC_ENTRY = /^.{2,120}?(?:\.{3,}|…|\s\.\s\.\s|\t)\s*\d{1,4}\s*$/;
const TOC_TITLE = /^\s*(table des matières|sommaire|contents|table of contents)\s*$/i;

/** Le même en-tête peut porter un numéro variable : on compare les lignes sans leurs chiffres. */
const lineKey = (line: string) => line.trim().replace(/\d+/g, '#').toLowerCase();

export function cleanText({ pages, paged }: Extracted): string {
  const repeated = new Set<string>();
  if (paged && pages.length >= 4) {
    const seen = new Map<string, number>();
    for (const page of pages) {
      for (const key of new Set(page.split('\n').map(lineKey))) {
        if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    for (const [key, n] of seen) if (n / pages.length > 0.3) repeated.add(key);
  }

  const kept: string[] = [];
  for (const line of pages.join('\n\n').split('\n')) {
    const t = line.trim();
    if (repeated.has(lineKey(line))) continue;
    if (t && (PAGE_NUMBER.test(t) || ROMAN_PAGE.test(t) || TOC_ENTRY.test(t) || TOC_TITLE.test(t))) continue;
    if (t && t.length < 200 && COPYRIGHT.test(t)) continue;
    kept.push(line.trimEnd());
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 3 segments de 3 000 mots à 15 %, 50 % et 85 % ; répartis sans chevauchement si le livre est court. */
export function sampleSegments(text: string): string[] {
  const tokens = text.match(/\S+\s*/g) ?? [];
  const n = tokens.length;
  if (n < MIN_WORDS) {
    throw new AppError(
      422,
      'reference_too_short',
      `Le fichier de référence est trop court (${n} mots, ${MIN_WORDS} minimum) pour en extraire un style fiable.`,
    );
  }
  const slice = (start: number, size: number) => tokens.slice(start, start + size).join('').trim();
  if (n < FULL_SEGMENTS_THRESHOLD) {
    const size = Math.floor(n / 3);
    return [0, 1, 2].map((i) => slice(i * size, size));
  }
  return [0.15, 0.5, 0.85].map((pos) => {
    const start = Math.floor(n * pos) - SEGMENT_WORDS / 2;
    return slice(Math.max(0, Math.min(start, n - SEGMENT_WORDS)), SEGMENT_WORDS);
  });
}

const STOPWORDS: Record<string, string[]> = {
  fr: ['le', 'la', 'les', 'des', 'une', 'et', 'est', 'dans', 'que', 'qui', 'pour', 'pas', 'elle', 'il'],
  en: ['the', 'and', 'was', 'that', 'with', 'his', 'her', 'for', 'had', 'not', 'she', 'he', 'but'],
  es: ['el', 'los', 'las', 'una', 'y', 'que', 'en', 'por', 'con', 'para', 'del', 'pero', 'no'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'mit', 'sich', 'auf', 'den'],
  it: ['il', 'lo', 'gli', 'una', 'che', 'per', 'con', 'del', 'della', 'non', 'sono', 'era'],
};

export function detectLanguage(text: string): string {
  const words = text.slice(0, 50_000).toLowerCase().match(/\p{L}+/gu) ?? [];
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  let best = 'und';
  let bestScore = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const score = list.reduce((s, w) => s + (counts.get(w) ?? 0), 0);
    if (score > bestScore) [best, bestScore] = [lang, score];
  }
  return best;
}

export interface ParsedReference {
  segments: string[];
  wordCount: number;
  language: string;
}

export async function parseReference(buf: Buffer): Promise<ParsedReference> {
  if (buf.length > MAX_UPLOAD_BYTES) throw badRequest('Le fichier dépasse la limite de 20 Mo.');
  const kind = await detectFileKind(buf);
  const text = cleanText(await extractRaw(buf, kind));
  return { segments: sampleSegments(text), wordCount: countWords(text), language: detectLanguage(text) };
}
