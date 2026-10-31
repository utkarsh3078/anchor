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
