import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citedNumbers, generateAnswer } from '../src/lib/generate.js';
import { reformulateQuery } from '../src/lib/reformulate.js';

test('reads single and grouped citation markers, deduplicated and sorted', () => {
  assert.deepEqual(citedNumbers('Backwash every 36 hours [2]. Air scour first [1, 2]. See [3,1].'), [1, 2, 3]);
});

test('ignores text without markers', () => {
  assert.deepEqual(citedNumbers('No citations here, not even [a].'), []);
});

// Fake Gemini client: records requests, returns canned text
function fakeGemini(text, extra = {}) {
  const calls = [];
  const ai = { models: { generateContent: async (req) => { calls.push(req); return { text }; } } };
  return { gemini: { ai, model: 'gemini-a', rewriteModel: 'gemini-b', useCache: true, ...extra }, calls };
}

const hits = [
  { id: 'd_1', docName: 'd.pdf', page: 2, text: 'The code is CL-7Q.', score: 0.9 },
  { id: 'd_2', docName: 'd.pdf', page: 3, text: 'Unrelated.', score: 0.1 },
];

test('answer uses the chosen model, maps citations, flags invalid ones', async () => {
  const { gemini, calls } = fakeGemini(JSON.stringify({ answerable: true, answer: 'It is CL-7Q [1] [7].' }));
  const r = await generateAnswer('What is the code? (test 1)', hits, gemini);
  assert.equal(calls[0].model, 'gemini-a');
  assert.deepEqual(r.citations.map((c) => [c.n, c.page]), [[1, 2]]);
  assert.equal(r.invalidCitations, 1);
  assert.equal(r.cached, false);
});

test('identical question + passages + model is served from cache, no second request', async () => {
  const { gemini, calls } = fakeGemini(JSON.stringify({ answerable: true, answer: 'CL-7Q [1].' }));
  await generateAnswer('What is the code? (test 2)', hits, gemini);
  const again = await generateAnswer('What is the code? (test 2)', hits, gemini);
  assert.equal(calls.length, 1);
  assert.equal(again.cached, true);
  await generateAnswer('What is the code? (test 2)', hits, { ...gemini, useCache: false });
  assert.equal(calls.length, 2);
});

test('not answerable or empty answer counts as an abstention', async () => {
  const { gemini } = fakeGemini(JSON.stringify({ answerable: true, answer: '   ' }));
  assert.equal((await generateAnswer('Budget? (test 3)', hits, gemini)).answerable, false);
});

test('query rewrite uses the rewrite model and keeps only the first line', async () => {
  const { gemini, calls } = fakeGemini('"turbidity escalation contact"\nexplanation that should be dropped');
  const q = await reformulateQuery('Who to call if water is cloudy? (test 4)', ['Who to call if water is cloudy?'], hits, gemini);
  assert.equal(q, 'turbidity escalation contact');
  assert.equal(calls[0].model, 'gemini-b');
});

test('empty rewrite falls back to the original question', async () => {
  const { gemini } = fakeGemini('');
  assert.equal(await reformulateQuery('original (test 5)', ['original (test 5)'], [], gemini), 'original (test 5)');
});
