import { test } from 'node:test';
import assert from 'node:assert/strict';

// Modules build API clients at import time; dummy keys keep tests offline
process.env.GEMINI_API_KEY ||= 'test';
process.env.TYPESENSE_API_KEY ||= 'test';
const { confidenceSignals, attemptLog } = await import('../src/lib/signals.js');
const { hybridSearch } = await import('../src/lib/hybrid.js');
const { anchorRetrieve } = await import('../src/lib/anchor.js');
const { toMessage } = await import('../src/routes/ask.js');
const { labelledAttempts } = await import('../eval/metrics.js');

const ids = (...xs) => xs.map((id) => ({ id }));
const scored = (pairs) => pairs.map(([id, score]) => ({ id, score }));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test('signals: top score, gap to the second, mean of the top three', () => {
  const s = confidenceSignals({
    reranked: scored([['a', 0.8], ['b', 0.5], ['c', 0.2], ['d', 0.1]]),
    keyword: ids('a', 'b'), dense: ids('a', 'c'),
  });
  assert.equal(s.topScore, 0.8);
  close(s.top2Gap, 0.3);
  close(s.top3Mean, 0.5); // the fourth score is not part of it
});

test('signals: fewer than three reranked passages', () => {
  const two = confidenceSignals({ reranked: scored([['a', 0.6], ['b', 0.2]]), keyword: [], dense: [] });
  close(two.top2Gap, 0.4);
  close(two.top3Mean, 0.4);

  const one = confidenceSignals({ reranked: scored([['a', 0.6]]), keyword: [], dense: [] });
  assert.deepEqual([one.topScore, one.top2Gap, one.top3Mean], [0.6, null, 0.6]);

  const none = confidenceSignals({ reranked: [], keyword: ids('a'), dense: ids('a') });
  assert.deepEqual(none, { topScore: 0, top2Gap: null, top3Mean: null, overlap10: 1, topInBoth: false });
});

test('signals: overlap counts only the top 10 of each list', () => {
  const keyword = ids('k1', 'x', 'k3', 'y', 'k5', 'k6', 'k7', 'k8', 'k9', 'k10', 'z'); // z is 11th
  const dense = ids('x', 'y', 'z', 'd4');
  const s = confidenceSignals({ reranked: scored([['x', 0.9]]), keyword, dense });
  assert.equal(s.overlap10, 2); // x and y; z is outside the keyword top 10
});

test('signals: topInBoth needs the top reranked passage in both top-10 lists', () => {
  const lists = { keyword: ids('a', 'b'), dense: ids('a', 'c') };
  assert.equal(confidenceSignals({ reranked: scored([['a', 0.9], ['b', 0.1]]), ...lists }).topInBoth, true);
  assert.equal(confidenceSignals({ reranked: scored([['b', 0.9], ['a', 0.1]]), ...lists }).topInBoth, false); // keyword only
  assert.equal(confidenceSignals({ reranked: scored([['c', 0.9]]), ...lists }).topInBoth, false); // vector only

  const deep = [...ids('1', '2', '3', '4', '5', '6', '7', '8', '9', '10'), { id: 'a' }]; // a is 11th
  assert.equal(confidenceSignals({ reranked: scored([['a', 0.9]]), keyword: deep, dense: ids('a') }).topInBoth, false);
});

// hybridSearch with fake retrievers and a fake reranker (no Typesense, Gemini or Cohere)
const passage = (id) => ({ id, docName: 'd.pdf', page: 1, text: id, score: 1 });
function fakeDeps(rerankScores) {
  const calls = { topN: [] };
  return {
    calls,
    deps: {
      embed: async () => [0],
      searchDense: async () => ['a', 'b', 'c', 'd'].map(passage),
      searchKeyword: async () => ['b', 'a', 'e'].map(passage),
      rerankHits: async (_query, hits, { topN }) => {
        calls.topN.push(topN);
        return hits.map((h) => ({ ...h, score: rerankScores[h.id] ?? 0 })).sort((x, y) => y.score - x.score).slice(0, topN);
      },
    },
  };
}
// signals is set explicitly so the tests don't depend on CONFIDENCE_SIGNALS in a local .env
const searchOpts = { docIds: [], candidates: 10, weights: { keyword: 0.5, dense: 0.5 }, useRerank: true, signals: true };

test('hybridSearch: a reranked result carries its signals', async () => {
  const { deps } = fakeDeps({ b: 0.9, a: 0.6, e: 0.3, c: 0.1 });
  const r = await hybridSearch('q', { ...searchOpts, k: 4 }, deps);
  assert.deepEqual(r.hits.map((h) => h.id), ['b', 'a', 'e', 'c']);
  assert.equal(r.signals.topScore, 0.9);
  close(r.signals.top2Gap, 0.3);
  close(r.signals.top3Mean, 0.6);
  assert.equal(r.signals.overlap10, 2); // a and b are in both lists
  assert.equal(r.signals.topInBoth, true);
});

test('hybridSearch: k below 3 still scores three passages for the signals, returns k hits', async () => {
  const { deps, calls } = fakeDeps({ b: 0.9, a: 0.6, e: 0.3 });
  const r = await hybridSearch('q', { ...searchOpts, k: 1 }, deps);
  assert.deepEqual(calls.topN, [3]);
  assert.deepEqual(r.hits.map((h) => h.id), ['b']);
  assert.deepEqual(r.trace.rerank.map((h) => h.id), ['b']);
  close(r.signals.top3Mean, 0.6);
});

test('hybridSearch: signals off restores the old result (no signals, rerank asked for k)', async () => {
  const { deps, calls } = fakeDeps({ b: 0.9, a: 0.6, e: 0.3 });
  const r = await hybridSearch('q', { ...searchOpts, k: 1, signals: false }, deps);
  assert.deepEqual(calls.topN, [1]);
  assert.equal('signals' in r, false);
  assert.deepEqual(r.hits.map((h) => h.id), ['b']);
});

test('hybridSearch: no rerank, no signals', async () => {
  const { deps, calls } = fakeDeps({});
  const r = await hybridSearch('q', { ...searchOpts, k: 2, useRerank: false }, deps);
  assert.equal('signals' in r, false);
  assert.equal(calls.topN.length, 0);
});

test('anchorRetrieve: every attempt keeps its own signals; the decision still uses the top score', async () => {
  const perQuery = { q: { topScore: 0.1, overlap10: 1 }, q2: { topScore: 0.7, overlap10: 4 } };
  const search = async (query) => ({
    hits: [{ id: query, score: perQuery[query].topScore }], latencyMs: 1, timings: {}, trace: {}, signals: perQuery[query],
  });
  const r = await anchorRetrieve('q', { k: 3, docIds: [], candidates: 10, weights: 'auto', threshold: 0.5, maxRetries: 2 },
    { search, reformulate: async () => 'q2' });
  assert.deepEqual(r.attempts.map((a) => a.signals), [perQuery.q, perQuery.q2]);
  assert.equal(r.bestAttempt, 1);
  assert.deepEqual(r.confidence, { topScore: 0.7, threshold: 0.5, confident: true });
});

test('attemptLog: one row per anchor attempt, without hits or trace', () => {
  const retrieval = {
    attempts: [
      { query: 'q', topScore: 0.1, hits: [passage('a')], trace: { big: true }, signals: { topScore: 0.1 } },
      { query: 'q2', topScore: 0.7, hits: [passage('b')], trace: {}, signals: { topScore: 0.7 } },
    ],
  };
  assert.deepEqual(attemptLog(retrieval, 'q'), [
    { attempt: 0, query: 'q', signals: { topScore: 0.1 } },
    { attempt: 1, query: 'q2', signals: { topScore: 0.7 } },
  ]);
});

test('attemptLog: reranked hybrid is one attempt; no rerank or signals off logs none or null', () => {
  assert.deepEqual(attemptLog({ hits: [], signals: { topScore: 0.4 } }, 'q'), [{ attempt: 0, query: 'q', signals: { topScore: 0.4 } }]);
  assert.deepEqual(attemptLog({ hits: [], confidence: null, retries: 0 }, 'q'), []); // dense, plain hybrid, overview
  assert.deepEqual(attemptLog({ attempts: [{ query: 'q', hits: [] }] }, 'q'), [{ attempt: 0, query: 'q', signals: null }]);
});

test('toMessage: the stored ask log has the attempts and their signals', () => {
  const signals = { topScore: 0.7, top2Gap: 0.2, top3Mean: 0.5, overlap10: 3, topInBoth: true };
  const response = {
    chatId: 'c', mode: 'anchor', model: 'm', answer: 'A [1]', abstained: false, lowConfidence: false, overview: false,
    citations: [{ n: 1, id: 'a', docName: 'd.pdf', page: 2, text: 'long passage text' }],
    retrieval: {
      confidence: { topScore: 0.7, threshold: 0.15, confident: true }, retries: 0, bestAttempt: 0,
      attempts: [{ query: 'q', topScore: 0.7, hits: [passage('a')], trace: { passages: {} }, signals }],
    },
    latencyMs: 5,
  };
  const doc = toMessage('q', response);
  assert.deepEqual(doc.attempts, [{ attempt: 0, query: 'q', signals }]);
  assert.equal(doc.bestAttempt, 0);
  assert.equal(JSON.stringify(doc).includes('long passage text'), false);

  const overview = toMessage('what is in the pdf', { ...response, retrieval: { overview: true, hits: [], confidence: null, retries: 0 } });
  assert.deepEqual([overview.attempts, overview.bestAttempt], [[], null]);
});

test('labelledAttempts: each attempt is labelled with whether its own hits contain a gold page', () => {
  const hitOn = (page) => ({ id: `d_${page}`, docName: 'd.pdf', page, text: '', score: 0.5 });
  const res = {
    hits: [hitOn(7)],
    attempts: [
      { query: 'q', hits: [hitOn(1)], signals: { topScore: 0.1 } },
      { query: 'q2', hits: [hitOn(7)], signals: { topScore: 0.6 } },
    ],
  };
  const q = { question: 'q', answerable: true, gold: [{ doc: 'd.pdf', page: 7 }] };
  assert.deepEqual(labelledAttempts(res, q).map((a) => [a.attempt, a.goldRetrieved, a.signals.topScore]), [[0, false, 0.1], [1, true, 0.6]]);

  // Unanswerable: nothing to find, whatever was retrieved
  assert.deepEqual(labelledAttempts(res, { question: 'q', answerable: false, gold: [] }).map((a) => a.goldRetrieved), [false, false]);
  // Reranked hybrid: one attempt, labelled from the response's hits
  assert.deepEqual(labelledAttempts({ hits: [hitOn(7)], signals: { topScore: 0.6 } }, q), [{ attempt: 0, query: 'q', signals: { topScore: 0.6 }, goldRetrieved: true }]);
  // No rerank: nothing to log
  assert.deepEqual(labelledAttempts({ hits: [hitOn(7)] }, q), []);
});
