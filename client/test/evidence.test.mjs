import test from 'node:test';
import assert from 'node:assert/strict';
import { answerSources, excerptOf, markSegments } from '../lib/evidence.js';

const citations = [
  { n: 1, id: 'd_0', docName: 'm.pdf', page: 1, text: 'Each filter bed holds a 600 mm sand layer. Filters are backwashed every 36 hours.' },
  { n: 3, id: 'd_2', docName: 'm.pdf', page: 4, text: 'An unrelated passage about pumps.' },
];
const ev = (n, quote) => ({ evidence: { n, quote, marks: [], clipped: false } });

test('answerSources: each cited passage gets the lines its statements were taken from', () => {
  const [a, b] = answerSources({ citations, support: { statements: [ev(1, 'Each filter bed holds a 600 mm sand layer.'), ev(1, 'Filters are backwashed every 36 hours.'), { evidence: null }] } });
  assert.deepEqual(a.quotes.map((q) => q.quote), ['Each filter bed holds a 600 mm sand layer.', 'Filters are backwashed every 36 hours.']);
  assert.equal(a.page, 1);
  assert.deepEqual(b.quotes, [{ quote: 'An unrelated passage about pumps.', marks: [], clipped: false, excerpt: true }]);
});

test('answerSources: the same line is listed once and a line inside a longer one is dropped', () => {
  const long = 'Each filter bed holds a 600 mm sand layer. Filters are backwashed every 36 hours.';
  const short = 'Filters are backwashed every 36 hours.';
  const quotes = (statements) => answerSources({ citations, support: { statements } })[0].quotes.map((q) => q.quote);
  assert.deepEqual(quotes([ev(1, short), ev(1, short)]), [short]);
  assert.deepEqual(quotes([ev(1, short), ev(1, long)]), [long]);
  assert.deepEqual(quotes([ev(1, long), ev(1, short)]), [long]);
});

test('answerSources: without the server check every source shows the start of its passage', () => {
  const sources = answerSources({ citations });
  assert.ok(sources.every((s) => s.quotes.length === 1 && s.quotes[0].excerpt));
  assert.deepEqual(answerSources({}), []);
});

test('excerptOf: a long passage is cut at a word', () => {
  const e = excerptOf('word '.repeat(100));
  assert.equal(e.clipped, true);
  assert.ok(e.quote.length <= 220 && e.quote.endsWith('word'));
});

test('markSegments: marked words in order, bad ranges ignored', () => {
  assert.deepEqual(markSegments('a 600 mm layer', [[2, 5], [9, 14]]),
    [{ text: 'a ', mark: false }, { text: '600', mark: true }, { text: ' mm ', mark: false }, { text: 'layer', mark: true }]);
  assert.deepEqual(markSegments('abc', [[1, 9]]), [{ text: 'abc', mark: false }]);
  assert.deepEqual(markSegments('abc'), [{ text: 'abc', mark: false }]);
});
