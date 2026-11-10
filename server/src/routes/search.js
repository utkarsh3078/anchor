import { Router } from 'express';
import { bm25Search, typesenseKeywordSearch } from '../lib/retrievers.js';
import { hybridSearch } from '../lib/hybrid.js';
import { anchorRetrieve } from '../lib/anchor.js';
import { denseRetrieve } from '../lib/retrieve.js';
import { ms } from '../lib/timing.js';
import { badRequest, parseWeights, parseAnchorOptions, parseFusionOptions, route, withGemini } from './common.js';

const router = Router();

// latencyMs is end-to-end (including the query embedding) so all modes are comparable.
// Every mode except keyword embeds the query, so it needs the caller's Gemini key.

// BASELINE 1: dense-only retrieval
router.post('/dense', withGemini, route(async ({ query, k, docIds }, _body, req) => (
  { mode: 'dense', ...(await denseRetrieve(query, { k, docIds, gemini: req.gemini })) }
)));

// Keyword-only retrieval (no Gemini call). engine: 'bm25' (default) or 'typesense'
router.post('/keyword', route(async ({ query, k, docIds }, body) => {
  const engine = body.engine ?? 'bm25';
  if (!['bm25', 'typesense'].includes(engine)) throw badRequest(`unknown engine: ${engine}`);
  const search = engine === 'bm25' ? bm25Search : typesenseKeywordSearch;
  const t0 = performance.now();
  const hits = await search(query, { k, docIds });
  return { mode: 'keyword', engine, latencyMs: ms(t0), hits };
}));

// BASELINE 2: static-weight hybrid (BM25 + dense, weighted RRF).
// rerank: true adds the Cohere rerank stage; weights: 'auto' adds query routing;
// fusion: 'convex' (+ alpha) swaps RRF for the convex combination of normalised scores.
router.post('/hybrid', withGemini, route(async ({ query, k, docIds, candidates }, body, req) => {
  const weights = parseWeights(body.weights);
  const useRerank = body.rerank ?? false;
  if (typeof useRerank !== 'boolean') throw badRequest('rerank must be true or false');

  const result = await hybridSearch(query, {
    k, docIds, candidates, weights, useRerank, gemini: req.gemini, ...parseFusionOptions(body),
  });
  return { mode: useRerank ? 'hybrid+rerank' : 'hybrid', ...result };
}));

// Full Anchor retrieval: routing + hybrid + rerank + confidence check and retry,
// without generation (for retrieval metrics)
router.post('/anchor', withGemini, route(async ({ query, k, docIds, candidates }, body, req) => {
  const opts = parseAnchorOptions(body);
  const result = await anchorRetrieve(query, { k, docIds, candidates, ...opts, gemini: req.gemini });
  return { mode: 'anchor', weights: opts.weights, ...result };
}));

export default router;
