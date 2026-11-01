import { embedQuery } from './embed.js';
import { denseSearch, bm25Search } from './retrievers.js';
import { weightedRrf } from './fusion.js';
import { rerank } from './rerank.js';
import { ms, timed } from './timing.js';

const rankList = (hits) => hits.map((h, i) => ({ id: h.id, rank: i + 1, score: h.score }));

// BM25 + dense fused with weighted RRF (baseline 2), optionally followed by a Cohere
// rerank of the top `candidates` fused hits. Returns the top k plus a trace of every stage.
export async function hybridSearch(query, { k, docIds, candidates, weights, useRerank = false }) {
  const t0 = performance.now();
  const [dense, keyword] = await Promise.all([
    timed(async () => denseSearch(await embedQuery(query), { k: candidates, docIds })),
    timed(() => bm25Search(query, { k: candidates, docIds })),
  ]);
  const fused = weightedRrf({ keyword: keyword.result, dense: dense.result }, weights);

  const timings = { denseMs: dense.ms, keywordMs: keyword.ms };
  const trace = { keyword: rankList(keyword.result), dense: rankList(dense.result) };

  if (!useRerank) {
    const top = fused.slice(0, k);
    trace.fused = top.map((f) => ({ id: f.hit.id, score: f.score, ranks: f.ranks }));
    return { latencyMs: ms(t0), timings, hits: top.map((f) => ({ ...f.hit, score: f.score })), trace };
  }

  const pool = fused.slice(0, candidates);
  const reranked = await timed(() => rerank(query, pool.map((f) => f.hit), { topN: k }));
  timings.rerankMs = reranked.ms;
  trace.fused = pool.map((f) => ({ id: f.hit.id, score: f.score, ranks: f.ranks }));
  trace.rerank = reranked.result.map((h) => ({ id: h.id, score: h.score }));
  return { latencyMs: ms(t0), timings, hits: reranked.result, trace };
}
