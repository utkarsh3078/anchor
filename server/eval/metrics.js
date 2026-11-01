// Gold evidence is page-level ({ doc, page }) because chunk ids change on every
// upload while page numbers don't.
export const isRelevant = (hit, gold) => gold.some((g) => g.doc === hit.docName && g.page === hit.page);

export const anyRelevant = (hits, gold) => hits.some((h) => isRelevant(h, gold));

// Fraction of gold pages that appear in the top k hits
export function recallAtK(hits, gold, k) {
  if (!gold.length) return 0;
  const top = hits.slice(0, k);
  return gold.filter((g) => top.some((h) => h.docName === g.doc && h.page === g.page)).length / gold.length;
}

// 1 / rank of the first relevant hit, 0 if none
export function reciprocalRank(hits, gold) {
  const i = hits.findIndex((h) => isRelevant(h, gold));
  return i === -1 ? 0 : 1 / (i + 1);
}

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Nearest-rank percentile
export function percentile(xs, p) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}
