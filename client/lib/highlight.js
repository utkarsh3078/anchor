// Finds which pdf.js text items on a page make up a cited passage, so the viewer can
// highlight exactly where the answer came from. The server built the passage from the
// same items (str + space/newline, whitespace collapsed), so after normalising both
// sides the passage is a substring of the page text.
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// items: [{ str, hasEOL }] from page.getTextContent(); returns item indices
export function findPassageItems(items, passage) {
  let page = '';
  const owner = []; // owner[c] = index of the item that produced character c of `page`
  items.forEach((item, i) => {
    for (const ch of `${item.str} `.toLowerCase().replace(/\s+/g, ' ')) {
      if (ch === ' ' && (page.length === 0 || page.endsWith(' '))) continue;
      page += ch;
      owner.push(i);
    }
  });

  const target = norm(passage);
  if (!target) return [];
  let start = page.indexOf(target);
  let end = start + target.length;
  if (start < 0) {
    // Fall back to the passage's first and last words (e.g. text that changed slightly)
    const head = target.slice(0, 60);
    const tail = target.slice(-60);
    const s = page.indexOf(head);
    const e = page.indexOf(tail, Math.max(s, 0));
    if (s < 0 && e < 0) return [];
    start = s >= 0 ? s : Math.max(0, e + tail.length - target.length);
    end = e >= 0 ? e + tail.length : Math.min(page.length, s + target.length);
  }
  return [...new Set(owner.slice(start, end))];
}
