// "From your document" under an answer: for every source the answer cites, the lines of
// the document it was taken from. The server finds those lines (`support.statements[].evidence`:
// the sentence of the cited passage that shares the most words and numbers with the
// statement). Pure functions, unit-tested with `npm test`.

const EXCERPT_MAX = 220;
const QUOTES_PER_SOURCE = 2;

// The opening of a passage, for a source the server found no exact line in
export function excerptOf(text = '', max = EXCERPT_MAX) {
  const clean = text.trim();
  if (clean.length <= max) return { quote: clean, marks: [], clipped: false, excerpt: true };
  const cut = clean.lastIndexOf(' ', max);
  return { quote: clean.slice(0, cut > 0 ? cut : max), marks: [], clipped: true, excerpt: true };
}

// data: the /api/ask response. One entry per cited passage, in citation order:
// { n, id, docName, page, text, quotes: [{ quote, marks, clipped, excerpt? }] }.
// A line used by several statements is listed once, and a line that is part of a longer
// one already listed is dropped.
export function answerSources({ citations = [], support } = {}) {
  return citations.map((c) => {
    let quotes = [];
    for (const s of support?.statements ?? []) {
      const e = s.evidence;
      if (!e || e.n !== c.n || quotes.some((q) => q.quote.includes(e.quote))) continue;
      quotes = [...quotes.filter((q) => !e.quote.includes(q.quote)), e];
    }
    return { ...c, quotes: quotes.length ? quotes.slice(0, QUOTES_PER_SOURCE) : [excerptOf(c.text)] };
  });
}

// A quote cut into plain and marked pieces: [{ text, mark }]. marks: [[start, end)]
export function markSegments(quote, marks = []) {
  const out = [];
  let at = 0;
  for (const [start, end] of [...marks].sort((a, b) => a[0] - b[0])) {
    if (start < at || end > quote.length) continue;
    if (start > at) out.push({ text: quote.slice(at, start), mark: false });
    out.push({ text: quote.slice(start, end), mark: true });
    at = end;
  }
  if (at < quote.length) out.push({ text: quote.slice(at), mark: false });
  return out;
}
