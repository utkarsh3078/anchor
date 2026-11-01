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

test('running headers are stripped, repeated short content lines are kept', async () => {
  const { stripRepeatedLines } = await import('../src/lib/pdf.js');
  const header = (n) => `Handbook of B.Tech. offered by USICT\nApplicable from Session 2024-25 Page ${n} of 113`;
  const subjects = ['Theory of Computation', 'Artificial Intelligence', 'Operating Systems', 'Computer Networks'];
  const pages = subjects.map((s, i) => ({
    page: i + 1,
    text: `${header(49 + i)}\nPaper Code: PC-20${i} Paper: ${s}\nUnit-1\n1.\nTopics of ${s.toLowerCase()} in detail.`,
  }));
  const out = stripRepeatedLines(pages);
  for (const p of out) {
    assert.ok(!p.text.includes('Handbook'));
    assert.ok(!p.text.includes('Page 4'));
    assert.ok(p.text.startsWith('Paper Code'));
    assert.ok(p.text.includes('Unit-1') && p.text.includes('\n1.\n'));
  }
});

test('short documents are left alone', async () => {
  const { stripRepeatedLines } = await import('../src/lib/pdf.js');
  const pages = [{ page: 1, text: 'Same header line here\nA' }, { page: 2, text: 'Same header line here\nB' }];
  assert.deepEqual(stripRepeatedLines(pages), pages);
});
