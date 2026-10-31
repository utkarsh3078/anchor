import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weightedRrf } from '../src/lib/fusion.js';

const h = (id) => ({ id, docName: 'd', page: 1, text: id, score: 0 });
const keyword = [h('x'), h('y'), h('z')];
const dense = [h('y'), h('w'), h('x')];

test('items found by both retrievers are boosted', () => {
  const fused = weightedRrf({ keyword, dense }, { keyword: 0.5, dense: 0.5 });
  assert.equal(fused[0].hit.id, 'y'); // ranks 2 and 1
  assert.deepEqual(fused[0].ranks, { keyword: 2, dense: 1 });
  assert.equal(fused.length, 4);
});

test('score follows w / (k + rank)', () => {
  const [top] = weightedRrf({ keyword, dense }, { keyword: 0.5, dense: 0.5 }, { k: 60 });
  assert.equal(top.score, 0.5 / 62 + 0.5 / 61);
});

test('weights shift the ranking toward the favoured retriever', () => {
  const kw = weightedRrf({ keyword, dense }, { keyword: 1, dense: 0 });
  assert.deepEqual(kw.slice(0, 3).map((f) => f.hit.id), ['x', 'y', 'z']);
  const dn = weightedRrf({ keyword, dense }, { keyword: 0, dense: 1 });
  assert.deepEqual(dn.slice(0, 3).map((f) => f.hit.id), ['y', 'w', 'x']);
});
