import { Router } from 'express';
import { embedQuery } from '../lib/embed.js';
import { denseSearch, bm25Search, typesenseKeywordSearch } from '../lib/retrievers.js';
import { hybridSearch } from '../lib/hybrid.js';
import { ms, timed } from '../lib/timing.js';

const router = Router();
const DEFAULT_WEIGHTS = { keyword: 0.5, dense: 0.5 };

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

function parseParams(body = {}) {
  const { query, k = 5, docIds = [], candidates = 50 } = body;
  if (typeof query !== 'string' || !query.trim()) return { error: 'query is required' };
  if (!Number.isInteger(k) || k < 1 || k > 50) return { error: 'k must be an integer from 1 to 50' };
  if (!Number.isInteger(candidates) || candidates < k || candidates > 250) {
    return { error: 'candidates must be an integer from k to 250' };
  }
  if (!Array.isArray(docIds)) return { error: 'docIds must be an array' };
  return { query: query.trim(), k, docIds, candidates };
}

// Normalised to sum to 1 so fused scores are on the same scale whatever the weights
function parseWeights(weights = DEFAULT_WEIGHTS) {
  const keyword = Number(weights.keyword ?? 0);
  const dense = Number(weights.dense ?? 0);
  if (!(keyword >= 0 && dense >= 0 && keyword + dense > 0)) return null;
  return { keyword: keyword / (keyword + dense), dense: dense / (keyword + dense) };
}

const route = (handler) => async (req, res) => {
  const params = parseParams(req.body);
  if (params.error) return res.status(400).json(params);
  try {
    res.json(await handler(params, req.body));
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  }
};

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
// rerank: true adds the Cohere rerank stage on top (mode 'hybrid+rerank').
router.post('/hybrid', route(async ({ query, k, docIds, candidates }, body) => {
  const weights = parseWeights(body.weights);
  if (!weights) throw badRequest('weights must be non-negative and not both zero');
  const useRerank = body.rerank ?? false;
  if (typeof useRerank !== 'boolean') throw badRequest('rerank must be true or false');

  const result = await hybridSearch(query, { k, docIds, candidates, weights, useRerank });
  return { mode: useRerank ? 'hybrid+rerank' : 'hybrid', weights, ...result };
}));

export default router;
