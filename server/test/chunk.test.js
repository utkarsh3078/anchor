import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPages } from '../src/lib/chunk.js';

const sentence = 'Retrieval quality depends on chunk boundaries and overlap. ';

test('chunks never cross pages and stay near the size limit', () => {
  const pages = [
    { page: 1, text: sentence.repeat(40).trim() },
    { page: 2, text: sentence.repeat(5).trim() },
  ];
  const chunks = chunkPages(pages);
  assert.ok(chunks.length > 2);
  for (const c of chunks) {
    assert.ok(c.text.length <= 900);
    assert.ok(pages[c.page - 1].text.includes(c.text));
  }
  assert.deepEqual(chunks.map((c) => c.chunkIndex), chunks.map((_, i) => i));
});

test('cuts at sentence ends when one is available', () => {
  const chunks = chunkPages([{ page: 1, text: sentence.repeat(40).trim() }]);
  for (const c of chunks.slice(0, -1)) assert.ok(c.text.endsWith('.'));
});

test('skips empty pages and tiny fragments', () => {
  assert.deepEqual(chunkPages([{ page: 1, text: '' }, { page: 2, text: 'too short' }]), []);
});
