import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRelevant, recallAtK, reciprocalRank, mean, percentile } from '../eval/metrics.js';

const hit = (docName, page) => ({ id: `${docName}_${page}`, docName, page, text: '', score: 0 });
const hits = [hit('a.pdf', 3), hit('b.pdf', 1), hit('a.pdf', 5), hit('a.pdf', 1)];

test('relevance needs both document and page to match', () => {
  assert.equal(isRelevant(hit('a.pdf', 5), [{ doc: 'a.pdf', page: 5 }]), true);
  assert.equal(isRelevant(hit('b.pdf', 5), [{ doc: 'a.pdf', page: 5 }]), false);
});

test('recall@k counts gold pages found in the top k', () => {
  const gold = [{ doc: 'a.pdf', page: 5 }, { doc: 'a.pdf', page: 1 }];
  assert.equal(recallAtK(hits, gold, 3), 0.5);
  assert.equal(recallAtK(hits, gold, 4), 1);
  assert.equal(recallAtK(hits, [{ doc: 'c.pdf', page: 1 }], 4), 0);
});

test('reciprocal rank uses the first relevant hit', () => {
  assert.equal(reciprocalRank(hits, [{ doc: 'a.pdf', page: 5 }, { doc: 'a.pdf', page: 1 }]), 1 / 3);
  assert.equal(reciprocalRank(hits, [{ doc: 'a.pdf', page: 3 }]), 1);
  assert.equal(reciprocalRank(hits, [{ doc: 'z.pdf', page: 9 }]), 0);
});

test('mean and nearest-rank percentile', () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(mean([]), null);
  assert.equal(percentile([5, 1, 4, 2, 3], 50), 3);
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
});
