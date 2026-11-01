import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeQuery } from '../src/lib/route.js';

const vocab = new Set(['backup', 'chlorinator', 'asset', 'code', 'cl', '7q', 'filters', 'backwashing',
  'turbidity', 'call', 'water', 'ntu', 'duty', 'officer']);

test('exact codes push toward keyword', () => {
  const r = routeQuery('What does CL-7Q do?', vocab);
  assert.ok(r.weights.keyword > 0.5);
  assert.equal(r.features.exactTerms, true);
});

test('acronyms and quoted phrases count as exact terms', () => {
  assert.equal(routeQuery('what is the NTU limit', vocab).features.exactTerms, true);
  assert.equal(routeQuery('find "duty officer"', vocab).features.exactTerms, true);
  assert.equal(routeQuery('who is the duty officer', vocab).features.exactTerms, false);
});

test('paraphrased query with words missing from the documents pushes toward dense', () => {
  const r = routeQuery('Who do I ring when the drinking supply looks murky?', vocab);
  assert.ok(r.weights.dense > 0.5);
  assert.ok(r.features.coverage < 0.5);
});

test('short fully-covered query leans keyword', () => {
  const r = routeQuery('backup chlorinator', vocab);
  assert.equal(r.features.coverage, 1);
  assert.equal(r.weights.keyword, 0.6);
});

test('weights always sum to 1, stay within bounds, and come with reasons', () => {
  for (const q of ['CL-7Q', 'x', 'a very long rambling question about many unrelated things that never appear anywhere', '']) {
    const { weights, reasons } = routeQuery(q, vocab);
    assert.equal(Math.round((weights.keyword + weights.dense) * 100), 100);
    assert.ok(weights.keyword >= 0.2 && weights.keyword <= 0.8);
    assert.ok(reasons.length > 0);
  }
});
