// Overlapping chunks, cut at sentence boundaries when possible.
// Chunks never cross page boundaries, so page citations stay exact.
export function chunkPages(pages, { size = 900, overlap = 150 } = {}) {
  const chunks = [];
  for (const { page, text } of pages) {
    if (!text) continue;
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + size, text.length);
      if (end < text.length) {
        const cut = text.lastIndexOf('. ', end);
        if (cut > start + size * 0.6) end = cut + 1;
      }
      const piece = text.slice(start, end).trim();
      if (piece.length > 40) chunks.push({ page, text: piece });
      if (end >= text.length) break;
      start = end - overlap;
    }
  }
  return chunks.map((c, i) => ({ ...c, chunkIndex: i }));
}
