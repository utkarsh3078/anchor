// Each configuration is one row of the results table. The list is an ablation ladder:
// every step adds one component, so the table shows what each component contributes.
// `body` is merged into { query, k, docIds }. `rerankCalls` counts the Cohere calls a
// response used, so the runner can pace itself under the trial rate limit.
// Fusion and gate are pinned in every body, so a server started with FUSION=convex or
// EVIDENCE_GATE=true still runs each configuration as named.
const STATIC = { keyword: 0.5, dense: 0.5 };
const RRF = { fusion: 'rrf' };
const NO_GATE = { ...RRF, gate: false };
const attempts = (r) => r.attempts.length;

export const CONFIGS = {
  dense: { path: '/api/search/dense', body: {}, rerankCalls: () => 0 },
  bm25: { path: '/api/search/keyword', body: { engine: 'bm25' }, rerankCalls: () => 0 },
  hybrid: { path: '/api/search/hybrid', body: { weights: STATIC, ...RRF }, rerankCalls: () => 0 },
  // Convex combination of normalised scores instead of RRF. alpha: --alpha, else the server's FUSION_ALPHA
  'hybrid-convex': { path: '/api/search/hybrid', body: { fusion: 'convex' }, rerankCalls: () => 0, convex: true },
  'hybrid+route': { path: '/api/search/hybrid', body: { weights: 'auto', ...RRF }, rerankCalls: () => 0 },
  'hybrid+rerank': { path: '/api/search/hybrid', body: { weights: STATIC, rerank: true, ...RRF }, rerankCalls: () => 1 },
  'anchor-noretry': { path: '/api/search/anchor', body: { maxRetries: 0, ...NO_GATE }, rerankCalls: attempts, anchor: true },
  'anchor-static': { path: '/api/search/anchor', body: { weights: STATIC, ...NO_GATE }, rerankCalls: attempts, anchor: true },
  anchor: { path: '/api/search/anchor', body: { ...NO_GATE }, rerankCalls: attempts, anchor: true },
  // Evidence gate instead of the threshold (needs the coefficients file; without it the
  // threshold decides and the rows say gate.used = false). Without the sufficiency check
  // the gate's middle zone counts as not confident; with it, Gemini decides the middle zone.
  'anchor-gate': { path: '/api/search/anchor', body: { ...RRF, gate: true, sufficiencyCheck: false }, rerankCalls: attempts, anchor: true, gate: true },
  'anchor-gate+check': { path: '/api/search/anchor', body: { ...RRF, gate: true, sufficiencyCheck: true }, rerankCalls: attempts, anchor: true, gate: true },
};

// The three configurations the paper compares
export const DEFAULT_CONFIGS = ['dense', 'hybrid', 'anchor'];
