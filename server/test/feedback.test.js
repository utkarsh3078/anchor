import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackTotals, parseFeedback, saveFeedback } from '../src/lib/feedback.js';
import { datasetProblems, draftDataset } from '../eval/drafts.js';

test('parseFeedback: up, down or null; comment trimmed and capped; null drops the comment', () => {
  assert.deepEqual(parseFeedback({ messageId: 'abc-1', rating: 'up' }), { messageId: 'abc-1', rating: 'up', comment: null });
  assert.deepEqual(parseFeedback({ messageId: 'abc-1', rating: 'down', comment: '  wrong page  ' }), { messageId: 'abc-1', rating: 'down', comment: 'wrong page' });
  assert.equal(parseFeedback({ messageId: 'a', rating: 'down', comment: 'x'.repeat(900) }).comment.length, 500);
  assert.deepEqual(parseFeedback({ messageId: 'a', rating: null, comment: 'gone' }), { messageId: 'a', rating: null, comment: null });
  assert.equal(parseFeedback({ messageId: 'a', rating: 'down', comment: '   ' }).comment, null);
});

test('parseFeedback: rejects bad ids, ratings and comments', () => {
  for (const body of [{}, { messageId: '' }, { messageId: 'a b' }, { messageId: 'a'.repeat(65) }, { messageId: 'a', rating: 'meh' }, { messageId: 'a', rating: 'up', comment: 5 }]) {
    assert.throws(() => parseFeedback(body), (e) => e.status === 400 && e.code === 'bad_request', JSON.stringify(body));
  }
});

// Fake collection: records updateOne calls, matches when the owner is "me"
function fakeMessages() {
  const calls = [];
  return { calls, updateOne: async (filter, update) => { calls.push({ filter, update }); return { matchedCount: filter.owner === 'me' ? 1 : 0 }; } };
}

test('saveFeedback: only the asking key can rate its answer; null removes the rating', async () => {
  const col = fakeMessages();
  const at = new Date('2026-11-18T10:00:00Z');
  assert.equal(await saveFeedback(col, { owner: 'me', messageId: 'm1', rating: 'down', comment: 'wrong' }, at), true);
  assert.deepEqual(col.calls[0], { filter: { messageId: 'm1', owner: 'me' }, update: { $set: { feedback: { rating: 'down', comment: 'wrong', at } } } });
  assert.equal(await saveFeedback(col, { owner: 'someone else', messageId: 'm1', rating: 'up', comment: null }), false);
  await saveFeedback(col, { owner: 'me', messageId: 'm1', rating: null, comment: null });
  assert.deepEqual(col.calls[2].update, { $unset: { feedback: '' } });
});

test('feedbackTotals: answers and refusals counted apart; rate is null with no ratings', () => {
  const t = feedbackTotals([
    { rating: 'up', abstained: false, at: '2026-11-18T10:00:00Z' },
    { rating: 'up', abstained: false, at: '2026-11-19T10:00:00Z' },
    { rating: 'down', abstained: false, at: '2026-11-17T10:00:00Z' },
    { rating: 'down', abstained: true, at: '2026-11-18T12:00:00Z' },
  ]);
  assert.deepEqual([t.rated, t.up, t.down], [4, 2, 2]);
  assert.equal(t.helpfulRate, 0.5);
  assert.deepEqual(t.answers, { rated: 3, up: 2, down: 1, helpfulRate: 2 / 3 });
  assert.deepEqual(t.refusals, { rated: 1, up: 0, down: 1, helpfulRate: 0 });
  assert.equal(t.first, '2026-11-17T10:00:00.000Z');
  assert.equal(t.last, '2026-11-19T10:00:00.000Z');
  assert.deepEqual(feedbackTotals([]), { rated: 0, up: 0, down: 0, helpfulRate: null, answers: { rated: 0, up: 0, down: 0, helpfulRate: null }, refusals: { rated: 0, up: 0, down: 0, helpfulRate: null }, first: null, last: null });
});

const rated = (messageId, query, extra) => ({ messageId, query, mode: 'anchor', model: 'm', feedback: { rating: 'down', comment: null, at: new Date('2026-11-18T10:00:00Z') }, ...extra });

test('draftDataset: one draft question per distinct question, with what the system did', () => {
  const d = draftDataset([
    rated('aaaaaaaa-1111', 'What is the fee?', { answer: 'It is 5 lakh [1].', abstained: false, citations: [{ docName: 'Syllabus.pdf', page: 3 }, { docName: 'Syllabus.pdf', page: 3 }], feedback: { rating: 'down', comment: 'not in the PDF', at: new Date('2026-11-18T10:00:00Z') } }),
    rated('bbbbbbbb-2222', '  what is the fee? ', { answer: 'Again', citations: [] }),
    rated('cccccccc-3333', 'Who is the mentor?', { answer: null, abstained: true, abstainReason: 'not_in_passages', citations: [] }),
  ], { name: 'feedback-x' });
  assert.equal(d.draft, true);
  assert.deepEqual(d.docs, [{ name: 'Syllabus.pdf', file: '' }]);
  assert.equal(d.questions.length, 2);
  const [fee, mentor] = d.questions;
  assert.deepEqual([fee.id, fee.answerable, fee.answer, fee.gold], ['fb-aaaaaaaa', null, '', []]);
  assert.deepEqual(fee.review.citedPages, ['Syllabus.pdf p.3']);
  assert.equal(fee.review.comment, 'not in the PDF');
  assert.deepEqual([mentor.review.abstained, mentor.review.systemAnswer, mentor.review.abstainReason], [true, null, 'not_in_passages']);
});

test('datasetProblems: a draft or an unfinished question is refused; a finished dataset passes', () => {
  const draft = draftDataset([rated('m1', 'Q?', { answer: 'A', citations: [] })], { name: 'f' });
  assert.equal(datasetProblems(draft).length, 2); // marked draft + answerable not set
  const finished = {
    questions: [
      { id: 'a', answerable: true, answer: 'x', gold: [{ doc: 'd.pdf', page: 1 }] },
      { id: 'u', answerable: false },
    ],
  };
  assert.deepEqual(datasetProblems(finished), []);
  assert.deepEqual(datasetProblems({ questions: [{ id: 'b', answerable: true, answer: 'x', gold: [] }] }), ['b: an answerable question needs an answer and gold pages']);
});
