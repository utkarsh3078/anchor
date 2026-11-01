import { getKeywordIndex } from './retrievers.js';

// Questions about a whole document ("what is inside the pdf?", "summarize this") match
// no single passage, so rerank scores are tiny (0.02-0.05 measured) even though the
// document can answer. These skip retrieval and get passages sampled across the documents.
const DOC = String.raw`(?:pdf|document|doc|file|notes?|paper|uploads?)`;
const OVERVIEW = [
  /\b(?:summari[sz]e|summary|overview|gist|outline|tl;?dr)\b/i,
  new RegExp(String.raw`\bwhat(?:'s| is| are)?\s+(?:in|inside)\s+(?:the|this|my|these|uploaded\s)*\s*${DOC}`, 'i'),
  new RegExp(String.raw`\b(?:contents?|topics?)\s+(?:of|in)\s+(?:the|this|my|uploaded\s)*\s*${DOC}`, 'i'),
  new RegExp(String.raw`\b(?:explain|describe)\s+(?:me\s+)?(?:the|this|my|uploaded\s)*\s*${DOC}\b`, 'i'),
  new RegExp(String.raw`\bwhat\s+is\s+(?:the|this|my)\s+${DOC}\s+about\b`, 'i'),
];

export const isOverviewQuery = (q) => OVERVIEW.some((re) => re.test(q));

// Evenly spaced chunks (always the first) from each document, n in total, in reading order
export function sampleChunks(chunks, n) {
  const byDoc = new Map();
  for (const c of chunks) {
    if (!byDoc.has(c.docId)) byDoc.set(c.docId, []);
    byDoc.get(c.docId).push(c);
  }
  const docs = [...byDoc.values()].map((list) => list.sort((a, b) => a.chunkIndex - b.chunkIndex));
  const per = Math.max(1, Math.floor(n / Math.max(docs.length, 1)));
  return docs.flatMap((list) => {
    if (list.length <= per) return list;
    const step = list.length / per;
    return Array.from({ length: per }, (_, i) => list[Math.floor(i * step)]);
  });
}

export async function overviewPassages(docIds, n = 12) {
  const { docs } = await getKeywordIndex();
  const allowed = docIds.length ? new Set(docIds) : null;
  return sampleChunks(docs.filter((d) => !allowed || allowed.has(d.docId)), n)
    .map(({ id, docName, page, text }) => ({ id, docName, page, text, score: null }));
}
