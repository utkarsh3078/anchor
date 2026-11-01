import { test } from 'node:test';
import assert from 'node:assert/strict';
// overview.js pulls in the Typesense client, which needs a key at import time
process.env.TYPESENSE_API_KEY ||= 'test';
const { isOverviewQuery, sampleChunks } = await import('../src/lib/overview.js');

test('whole-document questions are detected', () => {
  for (const q of [
    'what is inside the pdf?', 'explain me the content of pdf', 'summarize this document',
    'give me an overview', 'what is in my notes', 'what is this file about', 'topics of the uploaded pdf',
    'explain the pdf',
  ]) assert.equal(isOverviewQuery(q), true, q);
});

test('specific questions are not', () => {
  for (const q of [
    'okay what is the syllabus for AI', 'explain me NLP syllabus', 'what is question no. 1?',
    'who should I call if the water is cloudy', 'explain the approach towards question number 1',
  ]) assert.equal(isOverviewQuery(q), false, q);
});

test('samples evenly across each document, first chunk included, in reading order', () => {
  const chunks = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `a_${i}`, docId: 'a', chunkIndex: i })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `b_${i}`, docId: 'b', chunkIndex: i })),
  ].reverse();
  const out = sampleChunks(chunks, 8);
  const a = out.filter((c) => c.docId === 'a').map((c) => c.chunkIndex);
  assert.deepEqual(a, [0, 5, 10, 15]);
  assert.deepEqual(out.filter((c) => c.docId === 'b').map((c) => c.chunkIndex), [0, 1, 2]);
});
