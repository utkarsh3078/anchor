import { Router } from 'express';
import { anchorRetrieve } from '../lib/anchor.js';
import { generateAnswer } from '../lib/generate.js';
import { ms, timed } from '../lib/timing.js';
import { parseAnchorOptions, route } from './common.js';

const router = Router();

// Full pipeline: self-correcting retrieval, then a cited answer or an abstention.
// Two abstention reasons are kept separate so the evaluation can tell them apart:
//   low_retrieval_confidence: no attempt reached the threshold (Gemini is not called)
//   not_in_passages:          retrieval was confident but Gemini found no answer in it
router.post('/', route(async ({ query, k, docIds, candidates }, body) => {
  const opts = parseAnchorOptions(body);
  const t0 = performance.now();
  const retrieval = await anchorRetrieve(query, { k, docIds, candidates, ...opts });

  const abstain = (reason, extra = {}) => ({
    abstained: true, abstainReason: reason, answer: null, citations: [], ...extra,
    retrieval, latencyMs: ms(t0),
  });

  if (!retrieval.confidence.confident) return abstain('low_retrieval_confidence');

  const gen = await timed(() => generateAnswer(query, retrieval.hits));
  const timings = { retrievalMs: retrieval.latencyMs, generateMs: gen.ms };
  if (!gen.result.answerable) return abstain('not_in_passages', { timings });

  return {
    abstained: false,
    answer: gen.result.answer,
    citations: gen.result.citations,
    invalidCitations: gen.result.invalidCitations,
    retrieval,
    latencyMs: ms(t0),
    timings,
  };
}));

export default router;
