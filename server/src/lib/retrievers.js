import { ts, COLLECTION } from './typesense.js';
import { buildIndex, searchIndex } from './bm25.js';

// Every retriever returns hits in the shared shape { id, docName, page, text, score }
const toHit = (d, score) => ({ id: d.id, docName: d.docName, page: d.page, text: d.text, score });

function docFilter(docIds) {
  return docIds.length ? `docId:[${docIds.map((d) => '`' + d + '`').join(',')}]` : undefined;
}

async function runSearch(search) {
  const { results } = await ts.multiSearch.perform({ searches: [search] });
  if (results[0].error) throw new Error(results[0].error);
  return results[0].hits;
}

export async function denseSearch(queryVector, { k, docIds = [] }) {
  const hits = await runSearch({
    collection: COLLECTION,
    q: '*',
    vector_query: `embedding:([${queryVector.join(',')}], k:${k})`,
    exclude_fields: 'embedding',
    per_page: k,
    filter_by: docFilter(docIds),
  });
  return hits.map((h) => toHit(h.document, 1 - h.vector_distance)); // cosine similarity
}

// Typesense's own text-match ranking, kept as a comparison point for BM25
export async function typesenseKeywordSearch(query, { k, docIds = [] }) {
  const hits = await runSearch({
    collection: COLLECTION,
    q: query,
    query_by: 'text',
    exclude_fields: 'embedding',
    per_page: k,
    filter_by: docFilter(docIds),
  });
  return hits.map((h) => toHit(h.document, h.text_match));
}

// The BM25 index lives in memory, built from all chunks in Typesense on first use.
// Uploads and deletes call invalidateKeywordIndex() so the next query rebuilds it.
let indexPromise = null;

async function loadIndex() {
  const jsonl = await ts.collections(COLLECTION).documents().export({ exclude_fields: 'embedding' });
  const docs = jsonl ? jsonl.split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  return buildIndex(docs);
}

export function invalidateKeywordIndex() {
  indexPromise = null;
}

export async function bm25Search(query, { k, docIds = [] }) {
  indexPromise ??= loadIndex().catch((e) => {
    indexPromise = null;
    throw e;
  });
  return searchIndex(await indexPromise, query, { k, docIds });
}
