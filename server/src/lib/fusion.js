// Weighted Reciprocal Rank Fusion: score(d) = sum_i w_i / (k + rank_i(d)).
// lists: { name: hits[] } (each ranked best-first), weights: { name: number }.
// Returns [{ hit, score, ranks: { name: rank } }] sorted best-first.
export function weightedRrf(lists, weights, { k = 60 } = {}) {
  const fused = new Map();
  for (const [name, hits] of Object.entries(lists)) {
    const w = weights[name] ?? 0;
    hits.forEach((hit, i) => {
      const entry = fused.get(hit.id) ?? { hit, score: 0, ranks: {} };
      entry.score += w / (k + i + 1);
      entry.ranks[name] = i + 1;
      fused.set(hit.id, entry);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

// Min-max normalised scores of one ranked list: Map(id -> 0..1). When every score is
// the same (or there is one hit) each gets 1.
export function minMaxScores(hits) {
  const scores = hits.map((h) => h.score);
  const min = Math.min(...scores);
  const span = Math.max(...scores) - min;
  return new Map(hits.map((h) => [h.id, span > 0 ? (h.score - min) / span : 1]));
}

// Convex combination, the alternative to RRF that uses the scores instead of the ranks:
//   score(d) = alpha * dense'(d) + (1 - alpha) * keyword'(d)
// where ' is min-max normalisation within each candidate list and a passage missing from
// a list scores 0 there. alpha = 1 is vector-only, alpha = 0 is BM25-only.
// lists: { keyword: hits[], dense: hits[] }. Same return shape as weightedRrf.
export function convexFusion(lists, alpha) {
  const weights = { keyword: 1 - alpha, dense: alpha };
  const fused = new Map();
  for (const [name, hits] of Object.entries(lists)) {
    const norm = minMaxScores(hits);
    hits.forEach((hit, i) => {
      const entry = fused.get(hit.id) ?? { hit, score: 0, ranks: {} };
      entry.score += (weights[name] ?? 0) * norm.get(hit.id);
      entry.ranks[name] = i + 1;
      fused.set(hit.id, entry);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}
