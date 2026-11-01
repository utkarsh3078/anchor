import { ts, COLLECTION } from './typesense.js';

// Chunk ids are `${docId}_${chunkIndex}`
const parseId = (id) => {
  const i = id.lastIndexOf('_');
  return { docId: id.slice(0, i), chunkIndex: Number(id.slice(i + 1)) };
};
const neighbourIds = (id) => {
  const { docId, chunkIndex } = parseId(id);
  return { prev: chunkIndex > 0 ? `${docId}_${chunkIndex - 1}` : null, next: `${docId}_${chunkIndex + 1}` };
};

// Broad questions ("what is the syllabus for AI?") need the text around the best hits: a
// syllabus unit or a list usually spans consecutive chunks. For the top `around` hits the
// previous and next chunk of the same document are placed beside them, in reading order.
// Only the answer step sees these (marked neighbour: true); retrieval metrics are unchanged.
export async function withNeighbours(hits, { around = 4 } = {}) {
  const want = new Set();
  for (const h of hits.slice(0, around)) {
    const { prev, next } = neighbourIds(h.id);
    if (prev) want.add(prev);
    want.add(next);
  }
  for (const h of hits) want.delete(h.id);
  if (!want.size) return hits;

  let byId;
  try {
    const { results } = await ts.multiSearch.perform({
      searches: [{
        collection: COLLECTION,
        q: '*',
        filter_by: `id:[${[...want].map((id) => `\`${id}\``).join(',')}]`,
        include_fields: 'id,docName,page,text',
        per_page: want.size,
      }],
    });
    byId = new Map((results[0].hits ?? []).map((h) => [h.document.id, h.document]));
  } catch (e) {
    console.error('Fetching neighbour chunks failed, answering from hits only:', e.message);
    return hits;
  }

  const out = [];
  const seen = new Set();
  const push = (p) => {
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  };
  const neighbour = (id) => {
    const d = id && byId.get(id);
    return d && { id: d.id, docName: d.docName, page: d.page, text: d.text, score: null, neighbour: true };
  };
  hits.forEach((h, i) => {
    if (i >= around) return push(h);
    const { prev, next } = neighbourIds(h.id);
    push(neighbour(prev));
    push(h);
    push(neighbour(next));
  });
  return out;
}
