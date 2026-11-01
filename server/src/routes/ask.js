import { Router } from 'express';
import { randomUUID } from 'crypto';
import { retrieve, MODES } from '../lib/retrieve.js';
import { generateAnswer } from '../lib/generate.js';
import { ms, timed } from '../lib/timing.js';
import { safeWrite } from '../lib/db.js';
import { badRequest, parseAnchorOptions, parseWeights, route } from './common.js';

const router = Router();

// Question -> retrieval (mode: 'anchor' default, or 'dense' / 'hybrid' baselines)
// -> a cited answer or an abstention. Abstention reasons are kept separate so the
// evaluation can tell the two safety nets apart:
//   low_retrieval_confidence: anchor only, no attempt reached the threshold (Gemini not called)
//   not_in_passages:          Gemini found no answer in the retrieved passages
// Each exchange is saved under chatId (generated if absent) when MongoDB is configured.
router.post('/', route(async ({ query, k, docIds, candidates }, body) => {
  const mode = body.mode ?? 'anchor';
  if (!MODES.includes(mode)) throw badRequest(`mode must be one of ${MODES.join(', ')}`);
  const chatId = body.chatId ?? randomUUID();
  if (typeof chatId !== 'string') throw badRequest('chatId must be a string');

  const opts = parseAnchorOptions(body);
  // Baseline hybrid uses static weights unless told otherwise; anchor routes by default
  const weights = mode === 'hybrid' ? parseWeights(body.weights) : opts.weights;

  const t0 = performance.now();
  const retrieval = await retrieve(mode, query, { k, docIds, candidates, ...opts, weights });

  let result;
  if (retrieval.confidence && !retrieval.confidence.confident) {
    result = abstention('low_retrieval_confidence');
  } else {
    const gen = await timed(() => generateAnswer(query, retrieval.hits));
    const timings = { retrievalMs: retrieval.latencyMs, generateMs: gen.ms };
    result = gen.result.answerable
      ? {
        abstained: false,
        answer: gen.result.answer,
        citations: gen.result.citations,
        invalidCitations: gen.result.invalidCitations,
        timings,
      }
      : abstention('not_in_passages', { timings });
  }
  const response = { chatId, mode, ...result, retrieval, latencyMs: ms(t0) };

  await safeWrite('messages', (col) => col.insertOne(toMessage(query, response)));
  return response;
}));

function abstention(reason, extra = {}) {
  return { abstained: true, abstainReason: reason, answer: null, citations: [], ...extra };
}

// What gets stored: enough to show history and analyse runs, without the full trace
function toMessage(query, r) {
  return {
    chatId: r.chatId,
    mode: r.mode,
    query,
    answer: r.answer,
    abstained: r.abstained,
    abstainReason: r.abstainReason ?? null,
    citations: r.citations.map(({ n, id, docName, page }) => ({ n, id, docName, page })),
    confidence: r.retrieval.confidence,
    retries: r.retrieval.retries,
    latencyMs: r.latencyMs,
    createdAt: new Date(),
  };
}

export default router;
