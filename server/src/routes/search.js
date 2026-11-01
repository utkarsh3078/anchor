import { Router } from 'express';
import { embedQuery } from '../lib/embed.js';
import { denseSearch, bm25Search, typesenseKeywordSearch } from '../lib/retrievers.js';
import { hybridSearch } from '../lib/hybrid.js';
import { anchorRetrieve } from '../lib/anchor.js';
import { ms, timed } from '../lib/timing.js';
import { badRequest, parseWeights, parseAnchorOptions, route } from './common.js';

const router = Router();

// latencyMs is end-to-end (including the query embedding) so all modes are comparable

// BASELINE 1: dense-only retrieval
router.post('/dense', route(async ({ query, k, docIds }) => {
  const t0 = performance.now();
  const embed = await timed(() => embedQuery(query));
  const search = await timed(() => denseSearch(embed.result, { k, docIds }));
  return {
    mode: 'dense',
    latencyMs: ms(t0),
    timings: { embedMs: embed.ms, searchMs: search.ms },
    hits: search.result,
  };
}));

// Keyword-only retrieval. engine: 'bm25' (default) or 'typesense'
router.post('/keyword', route(async ({ query, k, docIds }, body) => {
  const engine = body.engine ?? 'bm25';
  if (!['bm25', 'typesense'].includes(engine)) throw badRequest(`unknown engine: ${engine}`);
  const search = engine === 'bm25' ? bm25Search : typesenseKeywordSearch;
  const t0 = performance.now();
  const hits = await search(query, { k, docIds });
  return { mode: 'keyword', engine, latencyMs: ms(t0), hits };
}));

// BASELINE 2: static-weight hybrid (BM25 + dense, weighted RRF).
// rerank: true adds the Cohere rerank stage; weights: 'auto' adds query routing.
router.post('/hybrid', route(async ({ query, k, docIds, candidates }, body) => {
  const weights = parseWeights(body.weights);
  const useRerank = body.rerank ?? false;
  if (typeof useRerank !== 'boolean') throw badRequest('rerank must be true or false');

  const result = await hybridSearch(query, { k, docIds, candidates, weights, useRerank });
  return { mode: useRerank ? 'hybrid+rerank' : 'hybrid', ...result };
}));

// Full Anchor retrieval: routing + hybrid + rerank + confidence check and retry,
// without generation (for retrieval metrics)
router.post('/anchor', route(async ({ query, k, docIds, candidates }, body) => {
  const opts = parseAnchorOptions(body);
  const result = await anchorRetrieve(query, { k, docIds, candidates, ...opts });
  return { mode: 'anchor', weights: opts.weights, ...result };
}));

export default router;
