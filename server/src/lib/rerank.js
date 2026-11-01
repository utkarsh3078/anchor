import { config } from '../config.js';

const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cross-encoder rerank: Cohere reads the query and each passage together, unlike the
// retrievers which score them separately. Returns hits best-first with
// score = Cohere relevance_score (0..1), which the confidence check will threshold.
// Trial keys allow 10 calls/minute, so a 429 waits and retries instead of failing.
export async function rerank(query, hits, { topN = hits.length, maxRetries = 3, baseDelayMs = 3000 } = {}) {
  if (!hits.length) return [];
  if (!config.cohere.apiKey) throw new Error('COHERE_API_KEY is not set');

  const body = JSON.stringify({
    model: config.cohere.rerankModel,
    query,
    documents: hits.map((h) => h.text),
    top_n: Math.min(topN, hits.length),
  });

  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(COHERE_RERANK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.cohere.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status !== 429 || attempt === maxRetries) break;
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * 2 ** attempt);
  }
  if (!res.ok) throw new Error(`Cohere rerank failed (${res.status}): ${await res.text()}`);

  const { results } = await res.json();
  return results.map((r) => ({ ...hits[r.index], score: r.relevance_score }));
}
