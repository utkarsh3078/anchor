// Each configuration is one row of the results table. The list is an ablation ladder:
// every step adds one component, so the table shows what each component contributes.
// `body` is merged into { query, k, docIds }. `rerankCalls` counts the Cohere calls a
// response used, so the runner can pace itself under the trial rate limit.
const STATIC = { keyword: 0.5, dense: 0.5 };

export const CONFIGS = {
  dense: { path: '/api/search/dense', body: {}, rerankCalls: () => 0 },
  bm25: { path: '/api/search/keyword', body: { engine: 'bm25' }, rerankCalls: () => 0 },
  hybrid: { path: '/api/search/hybrid', body: { weights: STATIC }, rerankCalls: () => 0 },
  'hybrid+route': { path: '/api/search/hybrid', body: { weights: 'auto' }, rerankCalls: () => 0 },
  'hybrid+rerank': { path: '/api/search/hybrid', body: { weights: STATIC, rerank: true }, rerankCalls: () => 1 },
  'anchor-noretry': { path: '/api/search/anchor', body: { maxRetries: 0 }, rerankCalls: (r) => r.attempts.length, anchor: true },
  'anchor-static': { path: '/api/search/anchor', body: { weights: STATIC }, rerankCalls: (r) => r.attempts.length, anchor: true },
  anchor: { path: '/api/search/anchor', body: {}, rerankCalls: (r) => r.attempts.length, anchor: true },
};

// The three configurations the paper compares
export const DEFAULT_CONFIGS = ['dense', 'hybrid', 'anchor'];
