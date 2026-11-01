import { Router } from 'express';
import { randomUUID } from 'crypto';
import { retrieve, MODES } from '../lib/retrieve.js';
import { generateAnswer } from '../lib/generate.js';
import { withNeighbours } from '../lib/context.js';
import { ms, timed } from '../lib/timing.js';
import { safeWrite } from '../lib/db.js';
import { badRequest, parseAnchorOptions, parseWeights, route, withGemini } from './common.js';

const router = Router();

// Question -> retrieval (mode: 'anchor' default, or 'dense' / 'hybrid' baselines)
// -> a cited answer or an abstention. Abstention reasons are kept separate so the
// evaluation can tell the two safety nets apart:
//   low_retrieval_confidence: anchor only, no attempt reached the threshold (Gemini not called)
//   not_in_passages:          Gemini found no answer in the retrieved passages
//   no_passages:              nothing retrieved (e.g. no documents selected; Gemini not called)
// Each exchange is saved under chatId (generated if absent) when MongoDB is configured.
// Gemini calls use the caller's key and model (headers, see lib/gemini.js).
// The answer sees the retrieved hits plus their neighbouring chunks (neighbours: false to
// turn that off); `context` in the response lists exactly what Gemini was given.
router.post('/', withGemini, route(async ({ query, k, docIds, candidates }, body, req) => {
  const mode = body.mode ?? 'anchor';
  if (!MODES.includes(mode)) throw badRequest(`mode must be one of ${MODES.join(', ')}`);
  const chatId = body.chatId ?? randomUUID();
  if (typeof chatId !== 'string') throw badRequest('chatId must be a string');

  const opts = parseAnchorOptions(body);
  const useNeighbours = body.neighbours ?? true;
  if (typeof useNeighbours !== 'boolean') throw badRequest('neighbours must be true or false');
  // Baseline hybrid uses static weights unless told otherwise; anchor routes by default
  const weights = mode === 'hybrid' ? parseWeights(body.weights) : opts.weights;

  const t0 = performance.now();
  const { gemini } = req;
  const retrieval = await retrieve(mode, query, { k, docIds, candidates, ...opts, weights, gemini });

  let result;
  let context = [];
  if (!retrieval.hits.length) {
    result = abstention('no_passages');
  } else if (retrieval.confidence && !retrieval.confidence.confident) {
    result = abstention('low_retrieval_confidence');
  } else {
    const passages = useNeighbours ? await withNeighbours(retrieval.hits) : retrieval.hits;
    context = passages.map(({ id, docName, page, text, neighbour }) => ({ id, docName, page, text, neighbour: Boolean(neighbour) }));
    const gen = await timed(() => generateAnswer(query, passages, gemini));
    const timings = { retrievalMs: retrieval.latencyMs, generateMs: gen.ms };
    const meta = { model: gen.result.model, cached: gen.result.cached, timings };
    result = gen.result.answerable
      ? {
        abstained: false,
        answer: gen.result.answer,
        citations: gen.result.citations,
        invalidCitations: gen.result.invalidCitations,
        ...meta,
      }
      : abstention('not_in_passages', meta);
  }
  const response = { chatId, mode, model: gemini.model, ...result, context, retrieval, latencyMs: ms(t0) };

  await safeWrite('messages', (col) => col.insertOne({ owner: gemini.keyHash, ...toMessage(query, response) }));
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
    model: r.model,
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
