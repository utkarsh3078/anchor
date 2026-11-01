import { embedQuery } from './embed.js';
import { denseSearch } from './retrievers.js';
import { hybridSearch } from './hybrid.js';
import { anchorRetrieve } from './anchor.js';
import { ms, timed } from './timing.js';

export const MODES = ['dense', 'hybrid', 'anchor'];

export async function denseRetrieve(query, { k, docIds }) {
  const t0 = performance.now();
  const embed = await timed(() => embedQuery(query));
  const search = await timed(() => denseSearch(embed.result, { k, docIds }));
  return { latencyMs: ms(t0), timings: { embedMs: embed.ms, searchMs: search.ms }, hits: search.result };
}

// Retrieval for /api/ask by mode, so baselines can be compared at the answer level.
// Only 'anchor' has a calibrated confidence (the Cohere score); for the baselines
// confidence is null and the answer step is their only abstention gate.
export async function retrieve(mode, query, opts) {
  if (mode === 'anchor') return anchorRetrieve(query, opts);
  const result = mode === 'dense'
    ? await denseRetrieve(query, opts)
    : await hybridSearch(query, { ...opts, useRerank: false });
  return { ...result, confidence: null, retries: 0 };
}
