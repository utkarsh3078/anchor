import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY ||= 'test';
const { citedNumbers } = await import('../src/lib/generate.js');

test('reads single and grouped citation markers, deduplicated and sorted', () => {
  assert.deepEqual(citedNumbers('Backwash every 36 hours [2]. Air scour first [1, 2]. See [3,1].'), [1, 2, 3]);
});

test('ignores text without markers', () => {
  assert.deepEqual(citedNumbers('No citations here, not even [a].'), []);
});
