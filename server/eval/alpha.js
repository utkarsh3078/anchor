import { convexFusion, weightedRrf } from '../src/lib/fusion.js';
import { recallAtK, reciprocalRank, mean } from './metrics.js';

// 0, 0.1, ..., 1
export const ALPHAS = Array.from({ length: 11 }, (_, i) => i / 10);

const score = (perQuestion, k, fuse) => {
  const ranked = perQuestion.map((q) => ({ gold: q.gold, hits: fuse(q).slice(0, k).map((f) => f.hit) }));
  return { recall: mean(ranked.map((r) => recallAtK(r.hits, r.gold, k))), mrr: mean(ranked.map((r) => reciprocalRank(r.hits, r.gold))) };
};

// Convex fusion at every alpha over the same candidate lists, so the search costs one
// retrieval per question however many alphas are tried.
// perQuestion: [{ gold, keyword: hits[], dense: hits[] }] (answerable questions only).
export function alphaGrid(perQuestion, { k, alphas = ALPHAS }) {
  return alphas.map((alpha) => ({ alpha, ...score(perQuestion, k, (q) => convexFusion({ keyword: q.keyword, dense: q.dense }, alpha)) }));
}

// Weighted RRF at static 0.5/0.5 on the same lists, as the reference row
export function rrfReference(perQuestion, { k }) {
  const weights = { keyword: 0.5, dense: 0.5 };
  return score(perQuestion, k, (q) => weightedRrf({ keyword: q.keyword, dense: q.dense }, weights));
}

// Highest recall, then highest MRR, then the alpha nearest 0.5 (the least extreme mix)
export function bestAlpha(grid) {
  return [...grid].sort((a, b) => b.recall - a.recall || b.mrr - a.mrr || Math.abs(a.alpha - 0.5) - Math.abs(b.alpha - 0.5))[0];
}
