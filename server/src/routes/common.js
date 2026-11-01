const DEFAULT_WEIGHTS = { keyword: 0.5, dense: 0.5 };
// Provisional, from a 5-question smoke test (answerable questions scored 0.18-0.92,
// unanswerable 0.03-0.25). Must be tuned on the evaluation set.
export const DEFAULT_THRESHOLD = 0.3;
const DEFAULT_MAX_RETRIES = 2;

export const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

export function parseParams(body = {}) {
  const { query, k = 5, docIds = [], candidates = 50 } = body;
  if (typeof query !== 'string' || !query.trim()) return { error: 'query is required' };
  if (!Number.isInteger(k) || k < 1 || k > 50) return { error: 'k must be an integer from 1 to 50' };
  if (!Number.isInteger(candidates) || candidates < k || candidates > 250) {
    return { error: 'candidates must be an integer from k to 250' };
  }
  if (!Array.isArray(docIds)) return { error: 'docIds must be an array' };
  return { query: query.trim(), k, docIds, candidates };
}

// Normalised to sum to 1 so fused scores are on the same scale whatever the weights
export function parseWeights(weights = DEFAULT_WEIGHTS) {
  const keyword = Number(weights.keyword ?? 0);
  const dense = Number(weights.dense ?? 0);
  if (!(keyword >= 0 && dense >= 0 && keyword + dense > 0)) {
    throw badRequest('weights must be non-negative and not both zero');
  }
  return { keyword: keyword / (keyword + dense), dense: dense / (keyword + dense) };
}

// threshold 0 never retries or abstains on retrieval grounds; maxRetries 0 disables retry
export function parseAnchorOptions(body = {}) {
  const { threshold = DEFAULT_THRESHOLD, maxRetries = DEFAULT_MAX_RETRIES } = body;
  if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
    throw badRequest('threshold must be a number from 0 to 1');
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) {
    throw badRequest('maxRetries must be an integer from 0 to 3');
  }
  return { weights: parseWeights(body.weights), threshold, maxRetries };
}

export const route = (handler) => async (req, res) => {
  const params = parseParams(req.body);
  if (params.error) return res.status(400).json(params);
  try {
    res.json(await handler(params, req.body));
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  }
};
