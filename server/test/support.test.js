import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSupport, contentWords, numbersIn, quoteFor, splitStatements, stem } from '../src/lib/support.js';

const passages = [
  { docName: 'plant-manual.pdf', page: 1, text: 'Each filter bed holds a 600 mm sand layer. Filters are backwashed every 36 hours, or sooner if head loss exceeds 2.4 m.' },
  { docName: 'plant-manual.pdf', page: 2, text: 'The backup chlorinator (asset code CL-7Q) is tested on the first Monday of every month. Water leaving the clearwell must hold a free chlorine residual of 1.2 mg/L.' },
  { docName: 'plant-manual.pdf', page: 3, text: 'If turbidity rises, call the Water Quality Duty Officer, Priya Raman, on extension 4417. The plant has three treatment stages.' },
];
const statuses = (answer, p = passages) => checkSupport(answer, p).statements.map((s) => s.status);

test('stem: plurals and verb endings meet at one form', () => {
  assert.equal(stem('filters'), stem('filter'));
  assert.equal(stem('cleaned'), stem('cleaning'));
  assert.equal(stem('needs'), stem('need'));
  assert.equal(stem('uses'), stem('used'));
  assert.equal(stem('using'), stem('use'));
  assert.equal(stem('hundreds'), stem('hundred'));
  assert.equal(stem('processes'), stem('processing'));
  assert.equal(stem('strings'), stem('string'));
  assert.equal(stem('includes'), stem('including'));
  assert.equal(stem('boxes'), stem('box'));
  assert.equal(stem('class'), 'class');
});

test('contentWords: stopwords, single letters and bare numbers are left out', () => {
  assert.deepEqual([...contentWords('The 3 filters of a plant').values()], ['filters', 'plant']);
});

test('numbersIn: thousands separators and leading zeros do not make a new number', () => {
  assert.deepEqual([...numbersIn('1,200 litres on 05 May, units 3, 4 and 2.4 m')], ['1200', '5', '3', '4', '2.4']);
});

test('splitStatements: one statement per citation, headings and lead-ins skipped', () => {
  const s = splitStatements('The plant has two lines [1]. It runs daily [2, 3].\n\n**Unit 1**\n- Search [1] [2]\n- **Logic**: rules [4]\nThe topics are:\n- Hosting');
  assert.deepEqual(s, [
    { text: 'The plant has two lines', cites: [1] },
    { text: 'It runs daily', cites: [2, 3] },
    { text: 'Search', cites: [1, 2] },
    { text: 'Logic: rules', cites: [4] },
  ]);
});

test('splitStatements: text after the last citation is a statement without one', () => {
  const s = splitStatements('The code is CL-7Q [2]. The plant was designed by a famous engineer.');
  assert.deepEqual(s[1], { text: 'The plant was designed by a famous engineer.', cites: [] });
  assert.equal(splitStatements('The code is CL-7Q [2]. Yes.').length, 1);
});

test('a statement that repeats its passage is supported', () => {
  const r = checkSupport('The backup chlorinator has asset code CL-7Q [2]. The sand layer is 600 mm thick [1].', passages);
  assert.deepEqual(r.statements.map((s) => s.status), ['supported', 'supported']);
  assert.deepEqual(r.summary, { statements: 2, supported: 2, partial: 0, unsupported: 0, uncited: 0 });
  assert.equal(r.statements[0].coverage, 1);
});

test('a number that is not in the cited passage is flagged even when the words match', () => {
  const [s] = checkSupport('Water leaving the clearwell must hold a free chlorine residual of 1.5 mg/L [2].', passages).statements;
  assert.equal(s.status, 'partial');
  assert.deepEqual(s.missingNumbers, ['1.5']);
});

test('a statement about something the passage does not say is unsupported', () => {
  const [s] = checkSupport('The annual budget was approved by the city council [1].', passages).statements;
  assert.equal(s.status, 'unsupported');
  assert.ok(s.missingTerms.includes('budget'));
});

test('a statement backed by a different passage reports where it was found', () => {
  const [s] = checkSupport('The backup chlorinator has asset code CL-7Q [1].', passages).statements;
  assert.notEqual(s.status, 'supported');
  assert.equal(s.elsewhere, 2);
});

test('no citation, or a citation number with no passage, is uncited', () => {
  assert.deepEqual(statuses('Filters are backwashed every 36 hours.'), ['uncited']);
  assert.deepEqual(statuses('Filters are backwashed every 36 hours [9].'), ['uncited']);
  assert.equal(checkSupport('Filters are backwashed every 36 hours.', passages).statements[0].elsewhere, 1);
});

test('several cited passages are read together; a digit is backed by the number word', () => {
  assert.deepEqual(statuses('The sand layer is 600 mm and the chlorine residual is 1.2 mg/L [1, 2].'), ['supported']);
  assert.deepEqual(statuses('The plant has 3 treatment stages [3].'), ['supported']);
});

test('a document name or page number can come from the passage header', () => {
  assert.deepEqual(statuses('The plant manual covers filters [1].'), ['supported']);
});

test('an answer with nothing to check gives an empty result', () => {
  assert.deepEqual(checkSupport('**Overview**', passages).summary.statements, 0);
});

const manual = passages.map((p) => p.text).join(' ');
const marked = (q) => q.marks.map(([a, b]) => q.quote.slice(a, b));

test('quoteFor: the sentence the statement was taken from, with the shared words marked', () => {
  const q = quoteFor('The sand layer is 600 mm thick', manual);
  assert.equal(q.quote, 'Each filter bed holds a 600 mm sand layer.');
  assert.deepEqual(marked(q), ['600', 'mm', 'sand', 'layer']);
  assert.equal(q.clipped, false);
  assert.ok(manual.includes(q.quote)); // an unbroken slice, so the page viewer can highlight it
});

test('quoteFor: a neighbouring sentence joins when it holds more of the statement', () => {
  const q = quoteFor('The chlorinator CL-7Q is tested monthly and the residual is 1.2 mg/L', manual);
  assert.match(q.quote, /^The backup chlorinator .* 1\.2 mg\/L\.$/);
  assert.ok(marked(q).includes('7Q') && marked(q).includes('1.2'));
});

test('quoteFor: nothing in common means no quote; one shared word is not enough', () => {
  assert.equal(quoteFor('The annual budget was approved by the council', manual), null);
  assert.equal(quoteFor('The reservoir has many filters', manual), null);
});

test('quoteFor: a long list without full stops is cut around the shared words', () => {
  const list = `UNIT I ${'introduction history agents environments '.repeat(8)}heuristic functions A star search hill climbing ${'logic inference resolution planning '.repeat(8)}`;
  const q = quoteFor('It covers heuristic functions, A star search and hill climbing', list);
  assert.equal(q.clipped, true);
  assert.ok(q.quote.length <= 300);
  assert.ok(q.quote.includes('heuristic functions A star search hill climbing'));
  assert.ok(list.includes(q.quote));
  assert.ok(!/^\S*$/.test(q.quote) && /^\S/.test(q.quote));
});

test('checkSupport: each statement carries its quote from the best cited passage', () => {
  const r = checkSupport('The sand layer is 600 mm thick [1, 2]. The budget was approved by the council [1].', passages);
  assert.deepEqual([r.statements[0].evidence.n, r.statements[0].evidence.quote], [1, 'Each filter bed holds a 600 mm sand layer.']);
  assert.equal(r.statements[0].evidence.score, undefined);
  assert.equal(r.statements[1].evidence, null);
  assert.equal(checkSupport('Filters are backwashed every 36 hours.', passages).statements[0].evidence, null); // cites nothing
});
