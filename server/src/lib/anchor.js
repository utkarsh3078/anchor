import { hybridSearch } from './hybrid.js';
import { reformulateQuery } from './reformulate.js';
import { ms, timed } from './timing.js';

// Self-correcting retrieval: hybrid (routed per query when weights = 'auto') + rerank,
// and if the top rerank score is below `threshold`, reformulate the query and try
// again (up to maxRetries times). Each reformulated query is routed afresh.
// Every attempt is reranked against the ORIGINAL question, so attempt scores are
// comparable and a reformulation that drifts off-topic can't make itself look confident.
// The best-scoring attempt wins, since a retry can also make things worse.
export async function anchorRetrieve(question, opts, deps = {}) {
  const { k, docIds, candidates, weights, threshold, maxRetries, gemini } = opts;
  const { search = hybridSearch, reformulate = reformulateQuery } = deps;

  const t0 = performance.now();
  const attempts = [];
  let best = null;
  let query = question;

  for (let i = 0; i <= maxRetries; i++) {
    const result = await search(query, {
      k, docIds, candidates, weights, useRerank: true, rerankQuery: question, gemini,
    });
    const topScore = result.hits[0]?.score ?? 0;
    const attempt = {
      query, topScore, weights: result.weights, hits: result.hits,
      latencyMs: result.latencyMs, timings: result.timings, trace: result.trace,
    };
    if (result.signals) attempt.signals = result.signals; // logged per attempt, not used to decide
    attempts.push(attempt);
    if (!best || topScore > best.topScore) best = { index: i, topScore, hits: result.hits };

    // No hits means nothing is indexed for these docIds: a rewrite can't help, so don't
    // spend a Gemini request on it
    if (topScore >= threshold || i === maxRetries || !result.hits.length) break;

    const next = await timed(() => reformulate(question, attempts.map((a) => a.query), result.hits, gemini));
    attempt.reformulateMs = next.ms;
    const seen = attempts.some((a) => a.query.toLowerCase() === next.result.toLowerCase());
    if (seen) break; // nothing new to try
    query = next.result;
  }

  return {
    latencyMs: ms(t0),
    hits: best.hits,
    confidence: { topScore: best.topScore, threshold, confident: best.topScore >= threshold },
    bestAttempt: best.index,
    retries: attempts.length - 1,
    attempts,
  };
}
