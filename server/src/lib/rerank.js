import { config } from '../config.js';

const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank';

// Cross-encoder rerank: Cohere reads the query and each passage together, unlike the
// retrievers which score them separately. Returns hits best-first with
// score = Cohere relevance_score (0..1), which the confidence check will threshold.
export async function rerank(query, hits, { topN = hits.length } = {}) {
  if (!hits.length) return [];
  if (!config.cohere.apiKey) throw new Error('COHERE_API_KEY is not set');

  const res = await fetch(COHERE_RERANK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cohere.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.cohere.rerankModel,
      query,
      documents: hits.map((h) => h.text),
      top_n: Math.min(topN, hits.length),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Cohere rerank failed (${res.status}): ${await res.text()}`);

  const { results } = await res.json();
  return results.map((r) => ({ ...hits[r.index], score: r.relevance_score }));
}
