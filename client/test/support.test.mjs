import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHeadline, pagesOf, statementNote, statementSource } from '../lib/support.js';

const context = [{ id: 'a_0', page: 2 }, { id: 'a_1', page: 2 }, { id: 'a_2', page: 5 }];
const support = (statements, supported) => ({ summary: { statements, supported } });
const s = (status, extra = {}) => ({ status, cites: [1], elsewhere: null, missingNumbers: [], ...extra });

test('pagesOf: one page, several pages, repeats and unknown numbers', () => {
  assert.equal(pagesOf([1], context), 'page 2');
  assert.equal(pagesOf([1, 2, 3], context), 'pages 2 and 5');
  assert.equal(pagesOf([9], context), 'the cited passage');
});

test('checkHeadline: nothing to show without a check or without statements', () => {
  assert.equal(checkHeadline(undefined), null);
  assert.equal(checkHeadline(support(0, 0)), null);
});

test('checkHeadline: green only when every statement matched', () => {
  assert.deepEqual(checkHeadline(support(6, 6)), { tone: 'ok', text: 'All 6 statements match the pages they cite.' });
  assert.equal(checkHeadline(support(1, 1)).text, 'The statement in this answer matches the page it cites.');
  assert.equal(checkHeadline(support(2, 2)).text, 'Both statements match the pages they cite.');
  assert.deepEqual(checkHeadline(support(6, 4)), { tone: 'warn', text: '4 of 6 statements match the pages they cite. 2 need a look.' });
  assert.match(checkHeadline(support(6, 5)).text, /1 needs a look\.$/);
  assert.equal(checkHeadline(support(3, 0)).tone, 'warn');
  assert.match(checkHeadline(support(3, 0)).text, /couldn't match these 3 statements/);
});

test('statementNote: one sentence per verdict, no scores', () => {
  assert.deepEqual(statementNote(s('supported'), context), { tone: 'ok', text: 'Matches page 2.' });
  assert.equal(statementNote(s('partial'), context).text, 'Partly matches page 2. The wording differs from the source.');
  assert.equal(statementNote(s('partial', { missingNumbers: ['1.5'] }), context).text, "Check this: 1.5 isn't in the cited passage.");
  assert.equal(statementNote(s('partial', { missingNumbers: ['3', '40'] }), context).text, "Check this: 3 and 40 aren't in the cited passage.");
  assert.deepEqual(statementNote(s('unsupported'), context), { tone: 'bad', text: "Couldn't match this to page 2." });
  assert.equal(statementNote(s('uncited', { cites: [] }), context).text, 'No source is given for this statement.');
});

test('statementNote and statementSource: a statement found in another passage points there', () => {
  const wrong = s('unsupported', { elsewhere: 3 });
  assert.equal(statementNote(wrong, context).text, "Couldn't match this to page 2. The matching text is in source 3 (page 5).");
  assert.equal(statementSource(wrong, context).id, 'a_2');
  assert.equal(statementSource(s('supported', { cites: [2, 3] }), context).id, 'a_1');
  assert.equal(statementSource(s('uncited', { cites: [] }), context), undefined);
});
