import { test } from 'node:test';
import assert from 'node:assert/strict';

// Modules build API clients at import time; dummy keys keep tests offline
process.env.GEMINI_API_KEY ||= 'test';
process.env.TYPESENSE_API_KEY ||= 'test';
const { anchorRetrieve } = await import('../src/lib/anchor.js');

const opts = { k: 3, docIds: [], candidates: 10, weights: { keyword: 0.5, dense: 0.5 }, threshold: 0.5, maxRetries: 2 };

// Fake search: top score per query string, records how it was called
function fakeSearch(scores) {
  const calls = [];
  const search = async (query, o) => {
    calls.push({ query, rerankQuery: o.rerankQuery });
    return { hits: [{ id: query, score: scores[query] ?? 0 }], latencyMs: 1, timings: {}, trace: {} };
  };
  return { search, calls };
}

test('no retry when the first attempt is confident', async () => {
  const { search, calls } = fakeSearch({ q: 0.9 });
  const reformulate = async () => assert.fail('should not reformulate');
  const r = await anchorRetrieve('q', opts, { search, reformulate });
  assert.equal(calls.length, 1);
  assert.equal(r.retries, 0);
  assert.equal(r.confidence.confident, true);
});

test('retries with reformulated queries, always reranking against the original', async () => {
  const { search, calls } = fakeSearch({ q: 0.1, q2: 0.2, q3: 0.7 });
  const next = ['q2', 'q3'];
  const r = await anchorRetrieve('q', opts, { search, reformulate: async () => next.shift() });
  assert.deepEqual(calls.map((c) => c.query), ['q', 'q2', 'q3']);
  assert.ok(calls.every((c) => c.rerankQuery === 'q'));
  assert.equal(r.bestAttempt, 2);
  assert.equal(r.confidence.confident, true);
});

test('stops at maxRetries and keeps the best attempt, not the last', async () => {
  const { search, calls } = fakeSearch({ q: 0.1, q2: 0.4, q3: 0.2 });
  const next = ['q2', 'q3'];
  const r = await anchorRetrieve('q', opts, { search, reformulate: async () => next.shift() });
  assert.equal(calls.length, 3);
  assert.equal(r.bestAttempt, 1);
  assert.equal(r.hits[0].id, 'q2');
  assert.equal(r.confidence.confident, false);
});

test('stops early when the reformulation repeats a tried query', async () => {
  const { search, calls } = fakeSearch({ q: 0.1 });
  const r = await anchorRetrieve('q', opts, { search, reformulate: async () => 'Q' });
  assert.equal(calls.length, 1);
  assert.equal(r.retries, 0);
});

test('maxRetries 0 disables retry', async () => {
  const { search, calls } = fakeSearch({ q: 0.1 });
  await anchorRetrieve('q', { ...opts, maxRetries: 0 }, { search, reformulate: async () => 'x' });
  assert.equal(calls.length, 1);
});
