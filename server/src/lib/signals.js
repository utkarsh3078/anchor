// Confidence signals for one retrieval attempt, logged with every ask and eval row so a
// gate can later be fitted on them. Nothing here decides anything: the confidence check
// still uses the top rerank score alone.

// The keyword and vector lists are compared over their top 10
export const SIGNAL_LIST_TOP = 10;
// Rerank scores needed for the signals (top-3 mean), even when the caller wants k < 3
export const SIGNAL_RERANK_TOP = 3;

// reranked: hits best-first with Cohere scores; keyword / dense: the BM25 and vector
// candidate lists, best-first.
//   topScore   top rerank score (0 when nothing was retrieved, as in the confidence check)
//   top2Gap    1st minus 2nd rerank score; null with fewer than two reranked passages
//   top3Mean   mean of the top 3 rerank scores (of the 1 or 2 there are, if fewer); null with none
//   overlap10  how many passages are in both the BM25 top 10 and the vector top 10
//   topInBoth  whether the top reranked passage is in both of those top-10 lists
export function confidenceSignals({ reranked, keyword, dense }) {
  const scores = reranked.slice(0, SIGNAL_RERANK_TOP).map((h) => h.score);
  const keywordTop = new Set(keyword.slice(0, SIGNAL_LIST_TOP).map((h) => h.id));
  const denseTop = new Set(dense.slice(0, SIGNAL_LIST_TOP).map((h) => h.id));
  const topId = reranked[0]?.id;

  return {
    topScore: scores[0] ?? 0,
    top2Gap: scores.length >= 2 ? scores[0] - scores[1] : null,
    top3Mean: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    overlap10: [...keywordTop].filter((id) => denseTop.has(id)).length,
    topInBoth: topId !== undefined && keywordTop.has(topId) && denseTop.has(topId),
  };
}

// The per-attempt rows that get stored: [{ attempt, query, signals }], plus the evidence
// gate's verdict ({ probability, zone, sufficient }) for attempts it judged. `retrieval` is an
// anchor result (attempts[]) or a single reranked hybrid result (signals at the top
// level); retrieval without a rerank (dense, plain hybrid, whole-document overview) has
// no rerank scores, so it logs no attempts. signals is null when the server runs with
// CONFIDENCE_SIGNALS=false.
export function attemptLog(retrieval, query) {
  if (Array.isArray(retrieval?.attempts)) {
    return retrieval.attempts.map((a, i) => ({
      attempt: i, query: a.query, signals: a.signals ?? null, ...(a.gate && { gate: a.gate }),
    }));
  }
  if (retrieval?.signals) return [{ attempt: 0, query, signals: retrieval.signals }];
  return [];
}
