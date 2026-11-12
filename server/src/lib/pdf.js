import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { config } from '../config.js';

const unreadable = (message, code) => Object.assign(new Error(message), { status: 422, code });

// Returns [{ page, text }] so every chunk can cite its exact page.
// verbosity 0 = errors only (hides harmless font warnings like "TT: undefined function").
// maxPages is checked before any page is read, so a huge PDF costs no parsing time.
export async function extractPages(buffer, { maxPages = config.limits.maxPages } = {}) {
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
  } catch {
    throw unreadable('This PDF could not be opened (damaged or password-protected?)', 'bad_pdf');
  }
  if (pdf.numPages > maxPages) {
    throw unreadable(`PDFs can have up to ${maxPages} pages; this one has ${pdf.numPages}`, 'too_many_pages');
  }
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((i) => i.str + (i.hasEOL ? '\n' : ' '))
      .join('')
      .replace(/[ \t]+/g, ' ')
      .trim();
    pages.push({ page: p, text });
  }
  return stripRepeatedLines(pages);
}

// Running headers/footers ("Handbook of B.Tech ... Page 55 of 113") repeat on every page
// and put the same noise into every chunk, which blurs both BM25 and embeddings.
// A line is dropped when it sits in the first or last 3 lines of a page, repeats on at
// least half the pages (digits ignored, so page numbers don't matter) and is long enough
// not to be real content like "Unit-1".
const EDGE = 3;
const MIN_LENGTH = 10;

export function stripRepeatedLines(pages) {
  if (pages.length < 3) return pages;
  const key = (line) => line.trim().toLowerCase().replace(/\d+/g, '#');
  const edgeLines = (text) => {
    const lines = text.split('\n').filter((l) => l.trim());
    return new Set([...lines.slice(0, EDGE), ...lines.slice(-EDGE)].map(key));
  };

  const counts = new Map();
  for (const { text } of pages) {
    for (const k of edgeLines(text)) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const repeated = new Set([...counts]
    .filter(([k, n]) => n >= pages.length / 2 && k.length >= MIN_LENGTH)
    .map(([k]) => k));
  if (!repeated.size) return pages;

  return pages.map(({ page, text }) => {
    const lines = text.split('\n');
    const nonEmpty = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
    const edges = new Set([...nonEmpty.slice(0, EDGE), ...nonEmpty.slice(-EDGE)]);
    const kept = lines.filter((l, i) => !(edges.has(i) && repeated.has(key(l))));
    return { page, text: kept.join('\n').trim() };
  });
}
