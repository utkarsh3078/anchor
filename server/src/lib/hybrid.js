import { embedQuery } from './embed.js';
import { denseSearch, bm25Search, getKeywordIndex } from './retrievers.js';
import { weightedRrf } from './fusion.js';
import { rerank } from './rerank.js';
import { routeQuery } from './route.js';
import { ms, timed } from './timing.js';

const rankList = (hits) => hits.map((h, i) => ({ id: h.id, rank: i + 1, score: h.score }));

// Text and location of the passages the trace shows, so the client can display them and
// open the source page (the ranked lists only carry ids). Top 10 per list keeps it small.
const TRACE_TOP = 10;
function tracePassages(...lists) {
  const out = {};
  for (const list of lists) {
    for (const h of list.slice(0, TRACE_TOP)) out[h.id] ??= { docName: h.docName, page: h.page, text: h.text };
  }
  return out;
}

// BM25 + dense fused with weighted RRF (baseline 2), optionally followed by a Cohere
// rerank of the top `candidates` fused hits. Returns the top k plus a trace of every stage.
// weights: { keyword, dense } for static weights, or 'auto' to route per query.
// rerankQuery lets a retry retrieve with a reformulated query but still be scored
// against the user's original question. gemini = the request's Gemini context (key, models).
export async function hybridSearch(query, {
  k, docIds, candidates, weights, useRerank = false, rerankQuery = query, gemini,
}) {
  const t0 = performance.now();
  const routing = weights === 'auto' ? routeQuery(query, (await getKeywordIndex()).postings) : null;
  const used = routing ? routing.weights : weights;

  const [dense, keyword] = await Promise.all([
    timed(async () => denseSearch(await embedQuery(gemini, query), { k: candidates, docIds })),
    timed(() => bm25Search(query, { k: candidates, docIds })),
  ]);
  const fused = weightedRrf({ keyword: keyword.result, dense: dense.result }, used);

  const timings = { denseMs: dense.ms, keywordMs: keyword.ms };
  const trace = { routing, keyword: rankList(keyword.result), dense: rankList(dense.result) };

  if (!useRerank) {
    const top = fused.slice(0, k);
    trace.fused = top.map((f) => ({ id: f.hit.id, score: f.score, ranks: f.ranks }));
    const hits = top.map((f) => ({ ...f.hit, score: f.score }));
    trace.passages = tracePassages(keyword.result, dense.result, hits);
    return { latencyMs: ms(t0), weights: used, timings, hits, trace };
  }

  const pool = fused.slice(0, candidates);
  const reranked = await timed(() => rerank(rerankQuery, pool.map((f) => f.hit), { topN: k }));
  timings.rerankMs = reranked.ms;
  trace.fused = pool.map((f) => ({ id: f.hit.id, score: f.score, ranks: f.ranks }));
  trace.rerank = reranked.result.map((h) => ({ id: h.id, score: h.score }));
  trace.passages = tracePassages(keyword.result, dense.result, pool.map((f) => f.hit), reranked.result);
  return { latencyMs: ms(t0), weights: used, timings, hits: reranked.result, trace };
}
