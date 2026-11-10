import { hybridSearch } from './hybrid.js';
import { reformulateQuery } from './reformulate.js';
import { contextSufficient } from './sufficiency.js';
import { gateProbability, gateZone } from './gate.js';
import { ms, timed } from './timing.js';

// Self-correcting retrieval: hybrid (routed per query when weights = 'auto') + rerank,
// and if an attempt isn't confident, reformulate the query and try again (up to
// maxRetries times). Each reformulated query is routed afresh.
// Every attempt is reranked against the ORIGINAL question, so attempt scores are
// comparable and a reformulation that drifts off-topic can't make itself look confident.
//
// What "confident" means:
//   default        the top rerank score is at least `threshold`
//   evidence gate  (opts.gate = { model, low, high, sufficiency }, lib/gate.js) the gate's
//                  probability is in the high zone, or in the middle zone and Gemini says
//                  the passages are sufficient. Without the sufficiency check the middle
//                  zone counts as not confident. A gate without a model (no coefficients
//                  file), or an attempt without signals, uses the threshold.
// A confident attempt ends the loop and wins; otherwise the best-scoring attempt wins
// (gate probability, or top rerank score), since a retry can also make things worse.
export async function anchorRetrieve(question, opts, deps = {}) {
  const {
    k, docIds, candidates, weights, threshold, maxRetries, gemini, gate, fusion, alpha,
  } = opts;
  const { search = hybridSearch, reformulate = reformulateQuery, checkSufficiency = contextSufficient } = deps;

  async function decide(attempt) {
    if (!gate?.model || !attempt.signals || !attempt.hits.length) {
      return { confident: attempt.topScore >= threshold, score: attempt.topScore };
    }
    const probability = gateProbability(gate.model, attempt.signals);
    const zone = gateZone(probability, gate);
    let sufficient = null;
    if (zone === 'middle' && gate.sufficiency) {
      const check = await timed(() => checkSufficiency(question, attempt.hits, gemini));
      sufficient = check.result;
      attempt.sufficiencyMs = check.ms;
    }
    attempt.gate = { probability, zone, sufficient };
    return { confident: zone === 'high' || sufficient === true, score: probability };
  }

  const t0 = performance.now();
  const attempts = [];
  let best = null;
  let query = question;

  for (let i = 0; i <= maxRetries; i++) {
    const result = await search(query, {
      k, docIds, candidates, weights, useRerank: true, rerankQuery: question, gemini, fusion, alpha,
    });
    const topScore = result.hits[0]?.score ?? 0;
    const attempt = {
      query, topScore, weights: result.weights, hits: result.hits,
      latencyMs: result.latencyMs, timings: result.timings, trace: result.trace,
    };
    if (result.signals) attempt.signals = result.signals;
    const verdict = await decide(attempt);
    attempts.push(attempt);
    if (!best || verdict.confident || verdict.score > best.score) best = { index: i, topScore, hits: result.hits, ...verdict };

    // No hits means nothing is indexed for these docIds: a rewrite can't help, so don't
    // spend a Gemini request on it
    if (verdict.confident || i === maxRetries || !result.hits.length) break;

    const next = await timed(() => reformulate(question, attempts.map((a) => a.query), result.hits, gemini));
    attempt.reformulateMs = next.ms;
    const seen = attempts.some((a) => a.query.toLowerCase() === next.result.toLowerCase());
    if (seen) break; // nothing new to try
    query = next.result;
  }

  const confidence = { topScore: best.topScore, threshold, confident: best.confident };
  if (gate) {
    // What decided, for the trace and the logs. used: false = the threshold decided
    const decided = attempts[best.index].gate;
    confidence.gate = decided
      ? { used: true, low: gate.low, high: gate.high, sufficiencyCheck: gate.sufficiency, ...decided }
      : { used: false, reason: gate.model ? 'no_signals' : 'no_coefficients' };
  }

  return {
    latencyMs: ms(t0),
    hits: best.hits,
    confidence,
    bestAttempt: best.index,
    retries: attempts.length - 1,
    attempts,
  };
}
