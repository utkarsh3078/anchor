import { config } from '../config.js';
import { cohereMinute, takeCohereCall } from './limits.js';

const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cross-encoder rerank: Cohere reads the query and each passage together, unlike the
// retrievers which score them separately. Returns hits best-first with
// score = Cohere relevance_score (0..1), which the confidence check will threshold.
// Trial keys allow 10 calls/minute: calls are spaced server-wide to stay under that
// (lib/limits.js MinutePacer), and a 429 that still happens waits and retries.
export async function rerank(query, hits, { topN = hits.length, maxRetries = 3, baseDelayMs = 3000, pacer = cohereMinute } = {}) {
  if (!hits.length) return [];
  if (!config.cohere.apiKey) {
    throw Object.assign(new Error('COHERE_API_KEY is not set on the server'), { status: 503, code: 'rerank_unavailable' });
  }

  takeCohereCall(); // server-wide daily budget (lib/limits.js); throws when it is spent
  await pacer.wait(); // server-wide per-minute limit; throws cohere_quota if the wait is too long

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
  if (!res.ok) {
    // Cohere's reply goes to the log only; the client gets a plain message
    console.error(`Cohere rerank failed (${res.status}):`, (await res.text()).slice(0, 500));
    throw Object.assign(new Error(`Cohere rerank failed (${res.status})`), res.status === 429
      ? { status: 429, code: 'cohere_quota' }
      : { status: 502, code: 'cohere_error' });
  }

  const { results } = await res.json();
  return results.map((r) => ({ ...hits[r.index], score: r.relevance_score }));
}
