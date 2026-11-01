import { config } from '../config.js';
import { LruCache, cached } from './cache.js';

// 100 texts per request is the batch embedding maximum; fewer requests per upload
const BATCH = 100;

async function embed(gemini, texts, taskType) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await gemini.ai.models.embedContent({
      model: config.gemini.embedModel,
      contents: texts.slice(i, i + BATCH),
      config: { taskType, outputDimensionality: config.gemini.dim },
    });
    out.push(...res.embeddings.map((e) => e.values));
  }
  return out;
}

// A query's vector doesn't depend on whose key computed it, so one cache serves everyone
const queryVectors = new LruCache(1000);

// Documents and queries use different task types, which improves retrieval quality
export const embedDocuments = (gemini, texts) => embed(gemini, texts, 'RETRIEVAL_DOCUMENT');

export async function embedQuery(gemini, q) {
  const { value } = await cached(queryVectors, q, gemini.useCache, async () => (await embed(gemini, [q], 'RETRIEVAL_QUERY'))[0]);
  return value;
}
