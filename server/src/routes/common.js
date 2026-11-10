import { geminiContext, geminiHttpError } from '../lib/gemini.js';
import { loadGateModel } from '../lib/gate.js';
import { config } from '../config.js';
import { usage } from '../lib/usage.js';

const DEFAULT_WEIGHTS = { keyword: 0.5, dense: 0.5 };
// Provisional. Smoke test (prose manual): answerable 0.18-0.92, unanswerable 0.03-0.25.
// A list-style syllabus PDF: correct chunks scored only 0.15-0.24, so 0.3 abstained on
// everything. 0.15 keeps those; Gemini's not_in_passages check remains as a second gate.
// Must be tuned on the evaluation set.
export const DEFAULT_THRESHOLD = 0.15;
// One retry costs one Gemini request; on the smoke test retries never changed the
// result, so the free-tier-friendly default is 1 (the API allows up to 3)
const DEFAULT_MAX_RETRIES = 1;

export const badRequest = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });

// Every error response is { error: <code>, message } so the client can branch on the code
// (e.g. gemini_quota -> offer a model switch, gemini_key_invalid -> ask for the key again)
export function sendError(res, e) {
  const gemini = geminiHttpError(e);
  if (gemini?.body.error === 'gemini_quota') usage.noteLimit(res.req?.gemini, gemini.body);
  if (gemini) return res.status(gemini.status).json(gemini.body);
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.code || (e.status ? 'error' : 'server_error'), message: e.message });
}

// Attaches req.gemini (the caller's key and chosen models) for routes that call Gemini
export function withGemini(req, res, next) {
  try {
    req.gemini = geminiContext(req.headers);
    next();
  } catch (e) {
    sendError(res, e);
  }
}

export function parseParams(body = {}) {
  const { query, k = 5, docIds = [], candidates = 50 } = body;
  if (typeof query !== 'string' || !query.trim()) throw badRequest('query is required');
  if (!Number.isInteger(k) || k < 1 || k > 50) throw badRequest('k must be an integer from 1 to 50');
  if (!Number.isInteger(candidates) || candidates < k || candidates > 250) {
    throw badRequest('candidates must be an integer from k to 250');
  }
  if (!Array.isArray(docIds)) throw badRequest('docIds must be an array');
  return { query: query.trim(), k, docIds, candidates };
}

// 'auto' = per-query routing (lib/route.js). Static weights are normalised to sum to 1
// so fused scores are on the same scale whatever the weights.
export function parseWeights(weights = DEFAULT_WEIGHTS) {
  if (weights === 'auto') return 'auto';
  if (typeof weights !== 'object' || weights === null) {
    throw badRequest('weights must be "auto" or { keyword, dense }');
  }
  const keyword = Number(weights.keyword ?? 0);
  const dense = Number(weights.dense ?? 0);
  if (!(keyword >= 0 && dense >= 0 && keyword + dense > 0)) {
    throw badRequest('weights must be non-negative and not both zero');
  }
  return { keyword: keyword / (keyword + dense), dense: dense / (keyword + dense) };
}

// fusion: 'rrf' or 'convex' (default FUSION); alpha: the convex weight of the vector
// score, 0 to 1 (default FUSION_ALPHA). alpha is ignored by rrf.
export function parseFusionOptions(body = {}, defaults = config.fusion) {
  const fusion = body.fusion ?? defaults.method;
  if (!['rrf', 'convex'].includes(fusion)) throw badRequest('fusion must be "rrf" or "convex"');
  const alpha = body.alpha ?? defaults.alpha;
  if (typeof alpha !== 'number' || alpha < 0 || alpha > 1) throw badRequest('alpha must be a number from 0 to 1');
  return { fusion, alpha };
}

// Evidence gate options: gate (default EVIDENCE_GATE), gateLow / gateHigh (zone cut-offs)
// and sufficiencyCheck (the middle zone's Gemini call). Returns undefined when the gate
// is off; model is null when there is no coefficients file (the threshold then decides).
export function parseGateOptions(body = {}, { defaults = config.gate, loadModel = loadGateModel } = {}) {
  const bool = (name, fallback) => {
    const v = body[name] ?? fallback;
    if (typeof v !== 'boolean') throw badRequest(`${name} must be true or false`);
    return v;
  };
  if (!bool('gate', defaults.enabled)) return undefined;
  const low = body.gateLow ?? defaults.low;
  const high = body.gateHigh ?? defaults.high;
  const ok = (x) => typeof x === 'number' && x >= 0 && x <= 1;
  if (!ok(low) || !ok(high) || low > high) throw badRequest('gateLow and gateHigh must be numbers from 0 to 1 with gateLow <= gateHigh');
  return { model: loadModel(), low, high, sufficiency: bool('sufficiencyCheck', defaults.sufficiency) };
}

// Full Anchor routes per query by default; pass static weights to ablate routing.
// threshold 0 never retries or abstains on retrieval grounds; maxRetries 0 disables retry
export function parseAnchorOptions(body = {}) {
  const { threshold = DEFAULT_THRESHOLD, maxRetries = DEFAULT_MAX_RETRIES } = body;
  if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
    throw badRequest('threshold must be a number from 0 to 1');
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) {
    throw badRequest('maxRetries must be an integer from 0 to 3');
  }
  return {
    weights: parseWeights(body.weights ?? 'auto'), threshold, maxRetries,
    gate: parseGateOptions(body), ...parseFusionOptions(body),
  };
}

// handler(params, body, req) -> JSON response
export const route = (handler) => async (req, res) => {
  try {
    res.json(await handler(parseParams(req.body), req.body, req));
  } catch (e) {
    sendError(res, e);
  }
};
