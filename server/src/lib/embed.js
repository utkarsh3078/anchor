import { config } from '../config.js';
import { LruCache, cached } from './cache.js';
import { geminiHttpError } from './gemini.js';
import { MinuteBudget, estimateTokens, planBatches } from './pace.js';

// 100 texts per request is the batch embedding maximum; fewer requests per upload
const BATCH = 100;
// Token counts are estimates (pace.js), so only this share of the per-minute token limit is planned for
const TOKEN_MARGIN = 0.8;
// A batch refused by a per-minute limit waits and is sent again this many times before the upload fails
const MAX_QUOTA_WAITS = 3;
// Used when a per-minute 429 doesn't say how long to wait
const DEFAULT_QUOTA_WAIT_SEC = 60;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function call(gemini, texts, taskType) {
  return gemini.ai.models.embedContent({
    model: config.gemini.embedModel,
    contents: texts,
    config: { taskType, outputDimensionality: config.gemini.dim },
  });
}

async function embed(gemini, texts, taskType) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await call(gemini, texts.slice(i, i + BATCH), taskType);
    out.push(...res.embeddings.map((e) => e.values));
  }
  return out;
}

// One rolling per-minute budget per Gemini key (each visitor's key has its own quota)
const budgets = new LruCache(200);
function budgetFor(gemini, limits, now) {
  const key = gemini.keyHash ?? 'server';
  return budgets.get(key) ?? budgets.set(key, new MinuteBudget({ maxRequests: limits.rpm, maxTokens: limits.tpm * TOKEN_MARGIN, now }));
}

// Upload embedding that fits the key's per-minute limits: batches are sized to the
// request and token budget, each waits until the last minute's usage leaves room, and a
// batch refused by a per-minute limit waits the delay Gemini gives and is sent again, so
// the batches already embedded are not thrown away. A daily limit (or any other error)
// still fails at once: waiting can't fix it.
async function embedPaced(gemini, texts, taskType, { limits, sleep, now, budget = budgetFor(gemini, limits, now) }) {
  const batches = planBatches(texts, { maxTexts: Math.min(BATCH, limits.rpm), maxTokens: limits.tpm * TOKEN_MARGIN });
  const out = [];
  for (const [n, b] of batches.entries()) {
    for (let refused = 0; ; refused++) {
      const waitMs = budget.waitFor(b.end - b.start, b.tokens);
      if (waitMs > 0) {
        console.log(`Embedding: batch ${n + 1} of ${batches.length} waits ${Math.ceil(waitMs / 1000)} s for the per-minute limit`);
        await sleep(waitMs);
      }
      const used = budget.record(b.end - b.start, b.tokens);
      try {
        const res = await call(gemini, texts.slice(b.start, b.end), taskType);
        out.push(...res.embeddings.map((e) => e.values));
        break;
      } catch (e) {
        const quota = geminiHttpError(e)?.body;
        if (quota?.error !== 'gemini_quota' || quota.scope !== 'minute' || refused >= MAX_QUOTA_WAITS) throw e;
        budget.forget(used);
        const sec = quota.retryAfterSec ?? DEFAULT_QUOTA_WAIT_SEC;
        console.log(`Embedding: batch ${n + 1} of ${batches.length} hit the per-minute limit, trying again in ${sec} s`);
        await sleep(sec * 1000);
      }
    }
  }
  return out;
}

// A query's vector doesn't depend on whose key computed it, so one cache serves everyone
const queryVectors = new LruCache(1000);

// Documents and queries use different task types, which improves retrieval quality.
// pacing (default: EMBED_PACING) keeps the upload inside the per-minute limits; the rest
// of the options are for tests.
export function embedDocuments(gemini, texts, {
  pacing = config.gemini.embedPacing,
  limits = { rpm: config.gemini.embedRpm, tpm: config.gemini.embedTpm },
  sleep = wait, now = Date.now, budget,
} = {}) {
  if (!pacing) return embed(gemini, texts, 'RETRIEVAL_DOCUMENT');
  return embedPaced(gemini, texts, 'RETRIEVAL_DOCUMENT', { limits, sleep, now, budget });
}

// Questions are never held back; they are only counted, so an upload right after them
// leaves room for what they used.
export async function embedQuery(gemini, q) {
  const { value } = await cached(queryVectors, q, gemini.useCache, async () => {
    if (config.gemini.embedPacing) {
      budgetFor(gemini, { rpm: config.gemini.embedRpm, tpm: config.gemini.embedTpm }).record(1, estimateTokens(q));
    }
    return (await embed(gemini, [q], 'RETRIEVAL_QUERY'))[0];
  });
  return value;
}
