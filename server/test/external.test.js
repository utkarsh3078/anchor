import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from '../eval/csv.js';
import { COLUMNS, readSheet, sameText, sheetRows } from '../eval/sheets.js';
import { agreement, allMatched, checkVsJudge, externalSummary, supportStats } from '../eval/metrics.js';

const questions = [
  { id: 'q1', category: 'exact', question: 'What is the code?', answerable: true, gold: [{ doc: 'm.pdf', page: 2 }], answer: 'CL-7Q' },
  { id: 'q2', category: 'numeric', question: 'How thick, in mm?', answerable: true, gold: [{ doc: 'm.pdf', page: 1 }, { doc: 'm.pdf', page: 3 }], answer: '600 mm' },
  { id: 'u1', category: 'unanswerable', question: 'What is the budget?', answerable: false },
];
const splits = new Map([['q1', 'tune'], ['q2', 'test'], ['u1', 'test']]);

test('csv: commas, quotes and line breaks inside a cell survive a round trip', () => {
  const rows = [{ id: 'q1', answer: 'It says "CL-7Q", on page 2.\nSecond line; more' }, { id: 'q2', answer: '' }];
  assert.deepEqual(parseCsv(toCsv(['id', 'answer'], rows)), rows);
});

test('csv: a spreadsheet export with a BOM, semicolons and blank lines is read', () => {
  assert.deepEqual(parseCsv('﻿id;answer\r\nq1;"a;b"\r\n\r\nq2; yes \r\n'), [{ id: 'q1', answer: 'a;b' }, { id: 'q2', answer: 'yes' }]);
});

test('sheetRows: an empty sheet has the question, reference and gold pages, nothing graded', () => {
  const [a, b, u] = sheetRows(questions, splits);
  assert.deepEqual(Object.keys(a), COLUMNS);
  assert.equal(b.gold, 'm.pdf p.1; m.pdf p.3');
  assert.deepEqual([a.split, a.answerable, a.reference, a.answer, a.abstained, a.correctness], ['tune', 'yes', 'CL-7Q', '', '', '']);
  assert.equal(u.answerable, 'no');
  assert.match(u.reference, /not in the documents/);
});

test('sheetRows: a run fills in the answer, abstention and citation, never the correctness', () => {
  const answers = new Map([
    ['q1', { abstained: false, answer: 'CL-7Q [1].', citations: [{ n: 1 }], citedGold: true, correctness: 'correct' }],
    ['q2', { abstained: false, answer: '600 mm.', citations: [], correctness: 'correct' }],
    ['u1', { abstained: true, answer: null, citations: [] }],
  ]);
  const [a, b, u] = sheetRows(questions, splits, answers);
  assert.deepEqual([a.answer, a.abstained, a.citation, a.correctness], ['CL-7Q [1].', 'no', 'correct', '']);
  assert.equal(b.citation, 'none');
  assert.deepEqual([u.answer, u.abstained, u.citation], ['', 'yes', '']);
});

test('readSheet: graded rows, rows still to do, and values to fix', () => {
  const { rows, pending, problems } = readSheet([
    { id: 'q1', answer: 'CL-7Q', abstained: '', correctness: 'Correct', citation: 'none' },
    { id: 'q2', answer: '', abstained: '', correctness: '', citation: '' },
    { id: 'u1', answer: 'About 2 crore', abstained: 'no', correctness: 'incorrect', citation: 'wrong' },
    { id: 'zz', answer: 'x', abstained: 'no' },
  ], questions);
  assert.deepEqual(pending, ['q2']);
  assert.deepEqual(problems, ['zz: not a question of this dataset']);
  assert.deepEqual(rows.map((r) => [r.id, r.abstained, r.correctness, r.citation]),
    [['q1', false, 'correct', 'none'], ['u1', false, null, 'wrong']]); // no grade needed for an unanswerable question

  const bad = readSheet([{ id: 'q1', answer: 'x', abstained: 'maybe', correctness: 'right', citation: 'ok' }], questions);
  assert.equal(bad.rows.length, 0);
  assert.equal(bad.problems.length, 3);
});

test('readSheet: an abstention keeps no grade or citation', () => {
  const { rows } = readSheet([{ id: 'q1', answer: 'I do not know', abstained: 'YES', correctness: 'incorrect', citation: 'none' }], questions);
  assert.deepEqual([rows[0].abstained, rows[0].correctness, rows[0].citation, rows[0].answer], [true, null, null, null]);
});

test('sameText ignores line endings and spacing only', () => {
  assert.ok(sameText('a  b\r\nc', 'a b c '));
  assert.ok(!sameText('a b c', 'a b d'));
});

const g = (answerable, abstained, correctness = null, citation = null) => ({ answerable, abstained, correctness, citation });

test('externalSummary: a missing answer is wrong, an answered unanswerable question is wrong', () => {
  const s = externalSummary([
    g(true, false, 'correct', 'correct'), g(true, false, 'correct', 'none'), g(true, false, 'partial', 'wrong'),
    g(true, false, 'incorrect', 'correct'), g(true, true),
    g(false, true), g(false, false),
  ]);
  assert.equal(s.n, 7);
  assert.equal(s.accuracy, 2 / 5);
  assert.equal(s.partial, 1 / 5);
  assert.equal(s.answerRate, 5 / 7);
  assert.equal(s.accuracyOnAnswered, 2 / 5); // 4 graded answers + the answered unanswerable one
  assert.equal(s.unanswerableRejection, 1 / 2);
  assert.equal(s.falseAbstention, 1 / 5);
  assert.equal(s.citedCorrect, 2 / 4);
  assert.equal(s.noCitation, 1 / 4);
  assert.equal(s.ungraded, 0);
});

test('externalSummary: an answer nobody graded is left out of accuracy and counted', () => {
  const s = externalSummary([g(true, false, 'correct'), g(true, false, null)]);
  assert.equal(s.accuracy, 1);
  assert.equal(s.ungraded, 1);
  assert.equal(s.citedCorrect, null);
});

test('agreement: share of identical verdicts', () => {
  assert.deepEqual(agreement([{ a: 'correct', b: 'correct' }, { a: 'partial', b: 'correct' }]), { n: 2, rate: 0.5 });
  assert.deepEqual(agreement([]), { n: 0, rate: null });
});

const checked = (statements, supported, extra = {}) => ({ support: { summary: { statements, supported } }, ...extra });

test('supportStats: statements pooled over answers; unchecked answers left out', () => {
  const s = supportStats([checked(4, 4), checked(6, 3), checked(0, 0), { support: null }]);
  assert.deepEqual(s, { answers: 2, statements: 10, statementsMatched: 0.7, answersAllMatched: 0.5 });
  assert.equal(allMatched(checked(4, 4)), true);
  assert.equal(supportStats([]).statementsMatched, null);
});

test('checkVsJudge: judged answers grouped by the check, with the judge counts of each group', () => {
  const [pass, flagged] = checkVsJudge([
    checked(2, 2, { faithfulness: 'supported', answerable: true, correctness: 'correct' }),
    checked(3, 3, { faithfulness: 'partial', answerable: true, correctness: 'incorrect' }),
    checked(3, 1, { faithfulness: 'unsupported', answerable: false, correctness: 'no_reference' }),
    checked(3, 2, { faithfulness: 'supported', answerable: true, correctness: 'correct' }),
    checked(3, 3, { answerable: true }), // not judged
  ]);
  assert.deepEqual(pass, { allMatched: true, answers: 2, supported: 1, partial: 1, unsupported: 0, correct: 0.5 });
  assert.deepEqual(flagged, { allMatched: false, answers: 2, supported: 1, partial: 0, unsupported: 1, correct: 1 });
});
