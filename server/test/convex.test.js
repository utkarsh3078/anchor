import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY ||= 'test';
process.env.TYPESENSE_API_KEY ||= 'test';
const { convexFusion, minMaxScores, weightedRrf } = await import('../src/lib/fusion.js');
const { hybridSearch } = await import('../src/lib/hybrid.js');
const { parseFusionOptions } = await import('../src/routes/common.js');
const { ALPHAS, alphaGrid, bestAlpha, rrfReference } = await import('../eval/alpha.js');

const hit = (id, score, page = 1) => ({ id, docName: 'd.pdf', page, text: id, score });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('minMaxScores: best 1, worst 0, in between by position in the score range', () => {
  const m = minMaxScores([hit('a', 12), hit('b', 7), hit('c', 2)]);
  assert.deepEqual([m.get('a'), m.get('b'), m.get('c')], [1, 0.5, 0]);
});

test('minMaxScores: equal scores or a single hit normalise to 1', () => {
  assert.deepEqual([...minMaxScores([hit('a', 3), hit('b', 3)]).values()], [1, 1]);
  assert.deepEqual([...minMaxScores([hit('a', 0.4)]).values()], [1]);
  assert.equal(minMaxScores([]).size, 0);
});

const keyword = [hit('k1', 10), hit('both', 6), hit('k3', 2)]; // BM25 scores
const dense = [hit('both', 0.9), hit('d2', 0.8), hit('d3', 0.5)]; // cosine similarities

test('convexFusion: alpha * vector + (1 - alpha) * BM25 on normalised scores', () => {
  const fused = convexFusion({ keyword, dense }, 0.5);
  const by = Object.fromEntries(fused.map((f) => [f.hit.id, f]));
  close(by.both.score, 0.5 * 1 + 0.5 * 0.5); // top of dense, middle of keyword
  close(by.k1.score, 0.5); // keyword only
  close(by.d2.score, 0.5 * 0.75); // dense only: (0.8 - 0.5) / 0.4
  close(by.d3.score, 0);
  assert.equal(fused[0].hit.id, 'both');
  assert.deepEqual(by.both.ranks, { keyword: 2, dense: 1 });
  assert.deepEqual(by.k1.ranks, { keyword: 1 });
});

test('convexFusion: alpha 0 is the BM25 order, alpha 1 the vector order', () => {
  // Only the top two: the last passage of a list normalises to 0, the same as a passage
  // that is not in the list at all
  assert.deepEqual(convexFusion({ keyword, dense }, 0).slice(0, 2).map((f) => f.hit.id), ['k1', 'both']);
  assert.deepEqual(convexFusion({ keyword, dense }, 1).slice(0, 2).map((f) => f.hit.id), ['both', 'd2']);
});

test('convexFusion: uses score sizes, which RRF ignores', () => {
  // x wins BM25 by a wide margin and is a close third in the vector list; y is second
  // and first. By rank y is ahead (2 + 1 against 1 + 3); by score x is.
  const kw = [hit('x', 30), hit('y', 3), hit('z', 2.9), hit('w', 2.8)];
  const de = [hit('y', 0.81), hit('w', 0.808), hit('x', 0.805), hit('z', 0.6)];
  assert.equal(weightedRrf({ keyword: kw, dense: de }, { keyword: 0.5, dense: 0.5 })[0].hit.id, 'y');
  assert.equal(convexFusion({ keyword: kw, dense: de }, 0.5)[0].hit.id, 'x');
});

const deps = {
  embed: async () => [0],
  searchDense: async () => dense,
  searchKeyword: async () => keyword,
  keywordIndex: async () => assert.fail('convex fusion must not route'),
  rerankHits: async (_q, hits, { topN }) => hits.slice(0, topN).map((h, i) => ({ ...h, score: 0.9 - i * 0.1 })),
};
const opts = { k: 2, docIds: [], candidates: 10, signals: true };

test('hybridSearch: fusion convex ignores routing and reports alpha', async () => {
  const r = await hybridSearch('q', { ...opts, weights: 'auto', fusion: 'convex', alpha: 0.3 }, deps);
  assert.deepEqual(r.weights, { keyword: 0.7, dense: 0.3 });
  assert.deepEqual(r.trace.fusion, { method: 'convex', alpha: 0.3 });
  assert.equal(r.trace.routing, null);
  assert.deepEqual(r.hits.map((h) => h.id), ['k1', 'both']); // 0.7 and 0.3 + 0.7 * 0.5 = 0.65
});

test('hybridSearch: fusion rrf is the earlier result', async () => {
  const fixed = { keyword: 0.5, dense: 0.5 };
  const r = await hybridSearch('q', { ...opts, weights: fixed, fusion: 'rrf', alpha: 0.9 }, deps);
  const expected = weightedRrf({ keyword, dense }, fixed).slice(0, 2).map((f) => f.hit.id);
  assert.deepEqual(r.hits.map((h) => h.id), expected);
  assert.deepEqual(r.weights, fixed);
  assert.deepEqual(r.trace.fusion, { method: 'rrf' });
});

test('hybridSearch: convex fusion feeds the reranker and the signals too', async () => {
  const r = await hybridSearch('q', { ...opts, weights: 'auto', fusion: 'convex', alpha: 1, useRerank: true }, deps);
  assert.deepEqual(r.hits.map((h) => h.id), ['both', 'd2']); // vector order went into the fake reranker
  assert.equal(r.signals.topInBoth, true);
});

test('parseFusionOptions: defaults, overrides and validation', () => {
  const defaults = { method: 'rrf', alpha: 0.5 };
  assert.deepEqual(parseFusionOptions({}, defaults), { fusion: 'rrf', alpha: 0.5 });
  assert.deepEqual(parseFusionOptions({ fusion: 'convex', alpha: 0 }, defaults), { fusion: 'convex', alpha: 0 });
  assert.deepEqual(parseFusionOptions({}, { method: 'convex', alpha: 0.7 }), { fusion: 'convex', alpha: 0.7 });
  for (const body of [{ fusion: 'sum' }, { alpha: 1.2 }, { alpha: '0.5' }]) {
    assert.throws(() => parseFusionOptions(body, defaults), (e) => e.status === 400);
  }
});

test('alphaGrid: recall and MRR at every alpha from the same lists', () => {
  assert.deepEqual(ALPHAS, [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((a) => Math.round(a * 10) / 10));
  // Question 1's gold page is found by BM25 only, question 2's by the vectors only
  const perQuestion = [
    { gold: [{ doc: 'd.pdf', page: 7 }], keyword: [hit('g1', 9, 7), hit('n1', 1)], dense: [hit('n2', 0.9), hit('n3', 0.2)] },
    { gold: [{ doc: 'd.pdf', page: 8 }], keyword: [hit('n4', 9), hit('n5', 1)], dense: [hit('g2', 0.9, 8), hit('n6', 0.2)] },
  ];
  const grid = alphaGrid(perQuestion, { k: 1 });
  assert.equal(grid.length, 11);
  assert.deepEqual([grid[0].recall, grid[10].recall], [0.5, 0.5]); // each extreme finds one of the two
  assert.deepEqual([grid[0].mrr, grid[10].mrr], [0.5, 0.5]);
  const rrf = rrfReference(perQuestion, { k: 1 });
  assert.ok(rrf.recall >= 0 && rrf.recall <= 1);
});

test('bestAlpha: recall first, then MRR, then the least extreme alpha', () => {
  assert.equal(bestAlpha([{ alpha: 0, recall: 0.6, mrr: 0.9 }, { alpha: 0.3, recall: 0.8, mrr: 0.5 }]).alpha, 0.3);
  assert.equal(bestAlpha([{ alpha: 0.2, recall: 0.8, mrr: 0.5 }, { alpha: 0.9, recall: 0.8, mrr: 0.6 }]).alpha, 0.9);
  assert.equal(bestAlpha([{ alpha: 0.1, recall: 0.8, mrr: 0.5 }, { alpha: 0.6, recall: 0.8, mrr: 0.5 }, { alpha: 1, recall: 0.8, mrr: 0.5 }]).alpha, 0.6);
});
