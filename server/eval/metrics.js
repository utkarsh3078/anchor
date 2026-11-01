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

// Answer level. citations: [{ docName, page }]
// Share of an answer's citations that point at a gold page (null if nothing cited)
export function citationPrecision(citations, gold) {
  if (!citations.length) return null;
  return citations.filter((c) => isRelevant(c, gold)).length / citations.length;
}

// Shares of rows whose `field` equals each of `values`, e.g. { correct: 0.6, partial: 0.2 }
export function shares(rows, field, values) {
  return Object.fromEntries(values.map((v) => [v, rows.length ? rows.filter((r) => r[field] === v).length / rows.length : null]));
}

// Confidence-gate curve from recorded scores, no re-running needed. rows: [{ answerable, score }]
// At each threshold: share of answerable questions kept, share of unanswerable caught.
export function gateCurve(rows, thresholds) {
  const ans = rows.filter((r) => r.answerable);
  const unans = rows.filter((r) => !r.answerable);
  return thresholds.map((t) => ({
    threshold: t,
    answeredRate: mean(ans.map((r) => (r.score >= t ? 1 : 0))),
    abstainRate: mean(unans.map((r) => (r.score < t ? 1 : 0))),
  }));
}
