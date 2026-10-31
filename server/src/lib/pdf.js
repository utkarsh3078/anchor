import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Returns [{ page, text }] so every chunk can cite its exact page
export async function extractPages(buffer) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
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
  return pages;
}
