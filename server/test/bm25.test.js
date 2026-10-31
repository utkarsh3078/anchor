import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, buildIndex, searchIndex } from '../src/lib/bm25.js';

const docs = [
  { id: 'a_0', docId: 'a', docName: 'a.pdf', page: 1, text: 'Reciprocal rank fusion combines ranked lists.' },
  { id: 'a_1', docId: 'a', docName: 'a.pdf', page: 2, text: 'Dense retrieval uses embeddings and cosine similarity.' },
  { id: 'b_0', docId: 'b', docName: 'b.pdf', page: 1, text: 'BM25 is a ranking function. BM25 uses term frequency and IDF.' },
  { id: 'b_1', docId: 'b', docName: 'b.pdf', page: 1, text: 'The cat sat on the mat while the ranking was computed.' },
];
const index = buildIndex(docs);

test('tokenize lowercases, strips accents and stopwords, keeps digits', () => {
  assert.deepEqual(tokenize('The Café uses BM25, and 3 GPUs!'), ['cafe', 'uses', 'bm25', '3', 'gpus']);
});

test('returns hits in the shared shape, best first', () => {
  const hits = searchIndex(index, 'BM25 ranking', { k: 3 });
  assert.equal(hits[0].id, 'b_0');
  assert.deepEqual(Object.keys(hits[0]).sort(), ['docName', 'id', 'page', 'score', 'text']);
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].score >= hits[i].score);
});

test('rarer terms weigh more than common ones', () => {
  // "ranking" appears in two chunks, "embeddings" in one
  const [hit] = searchIndex(index, 'ranking embeddings', { k: 1 });
  assert.equal(hit.id, 'a_1');
});

test('docIds filter restricts results without changing scores', () => {
  const all = searchIndex(index, 'ranking', { k: 10 });
  const onlyB = searchIndex(index, 'ranking', { k: 10, docIds: ['b'] });
  assert.ok(onlyB.every((h) => h.id.startsWith('b_')));
  for (const h of onlyB) assert.equal(h.score, all.find((x) => x.id === h.id).score);
});

test('no matching terms gives no hits', () => {
  assert.deepEqual(searchIndex(index, 'quantum zebra', { k: 5 }), []);
  assert.deepEqual(searchIndex(buildIndex([]), 'anything', { k: 5 }), []);
});
