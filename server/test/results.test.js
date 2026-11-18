import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

process.env.GEMINI_API_KEY ||= 'test';
process.env.TYPESENSE_API_KEY ||= 'test';
process.env.MONGODB_URI = ''; // read run files only (empty, so .env can't fill it in)
const { publicResults, loadResults } = await import('../src/lib/results.js');

const dataset = {
  name: 'tiny',
  docs: [{ name: 'Lab_file.pdf' }, { name: 'Notes.pdf', label: 'Revision notes' }],
  questions: [
    { id: 'a1', category: 'exact', answerable: true, gold: [{ doc: 'Lab_file.pdf', page: 1 }], question: 'secret question text', answer: 'secret answer' },
    { id: 'a2', category: 'list', answerable: true, gold: [{ doc: 'Notes.pdf', page: 2 }], question: 'q', answer: 'a' },
    { id: 'u1', category: 'unanswerable', answerable: false, question: 'q' },
  ],
};
const rrow = (config, id, answerable, extra) => ({ config, id, answerable, category: dataset.questions.find((q) => q.id === id).category, latencyMs: 100, ...extra });
const retrieval = {
  kind: 'retrieval', dataset: 'tiny', startedAt: '2026-01-01T00:00:00.000Z',
  settings: { k: 5, configs: ['dense', 'hybrid', 'anchor-noretry', 'anchor'] },
  rows: [
    rrow('dense', 'a1', true, { recall: 1, rr: 1 }), rrow('dense', 'a2', true, { recall: 0, rr: 0 }), rrow('dense', 'u1', false, {}),
    rrow('hybrid', 'a1', true, { recall: 1, rr: 0.5 }), rrow('hybrid', 'a2', true, { recall: 1, rr: 1 }), rrow('hybrid', 'u1', false, {}),
    rrow('anchor-noretry', 'a1', true, { recall: 1, rr: 1, firstTopScore: 0.9 }), rrow('anchor-noretry', 'a2', true, { recall: 1, rr: 1, firstTopScore: 0.12 }),
    rrow('anchor-noretry', 'u1', false, { firstTopScore: 0.3 }),
    rrow('anchor', 'a1', true, { recall: 1, rr: 1, retries: 0, attempts: [{ goldRetrieved: true }], bestAttempt: 0 }),
    rrow('anchor', 'a2', true, { recall: 1, rr: 1, retries: 1, attempts: [{ goldRetrieved: false }, { goldRetrieved: true }], bestAttempt: 1 }),
    rrow('anchor', 'u1', false, { retries: 1, attempts: [{ goldRetrieved: false }, { goldRetrieved: false }], bestAttempt: 0 }),
    { config: 'dense', id: 'a1', error: 'boom' },
  ],
};
const arow = (mode, id, answerable, extra) => ({ mode, id, answerable, latencyMs: 2000, answer: 'secret generated answer', citations: [{ text: 'secret passage' }], ...extra });
const answers = {
  kind: 'answers', dataset: 'tiny', startedAt: '2026-01-02T00:00:00.000Z',
  settings: { k: 10, modes: ['anchor-soft', 'hybrid'] },
  grading: { by: 'a grader' },
  rows: [
    arow('anchor-soft', 'a1', true, { abstained: false, correctness: 'correct', citedGold: true, citationPrecision: 1, model: 'm1' }),
    arow('anchor-soft', 'a2', true, { abstained: false, correctness: 'partial', citedGold: true, citationPrecision: 0.5, model: 'm1' }),
    arow('anchor-soft', 'u1', false, { abstained: true, model: 'm1' }),
    arow('hybrid', 'a1', true, { abstained: true, model: 'm1' }),
    arow('hybrid', 'a2', true, { abstained: false, correctness: 'correct', citedGold: false, citationPrecision: 0, model: 'm1' }),
    arow('hybrid', 'u1', false, { abstained: false, model: 'm1' }),
  ],
};

test('results: retrieval totals per configuration, errors left out', () => {
  const r = publicResults({ retrieval, dataset }).retrieval;
  assert.deepEqual(r.configs.map((c) => [c.config, c.recall, c.mrr, c.found, c.answerable]),
    [['dense', 0.5, 0.5, 1, 2], ['hybrid', 1, 0.75, 2, 2], ['anchor-noretry', 1, 1, 2, 2], ['anchor', 1, 1, 2, 2]]);
  assert.equal(r.configs[0].label, 'Meaning search');
  assert.equal(r.questions, 3);
});

test('results: by question type and by document (dataset label, else the tidied file name)', () => {
  const r = publicResults({ retrieval, dataset }).retrieval;
  assert.deepEqual(r.byCategory.find((c) => c.category === 'list'), { category: 'list', questions: 1, recall: { dense: 0, hybrid: 1, 'anchor-noretry': 1, anchor: 1 } });
  assert.deepEqual(r.byDocument.map((d) => [d.document, d.recall.dense]), [['Lab file', 1], ['Revision notes', 0]]); // tidied name, then a set label
});

test('results: threshold curve from the first-attempt scores, and retries that found a page', () => {
  const r = publicResults({ retrieval, dataset }).retrieval;
  const at = (t) => r.threshold.find((x) => x.threshold === t);
  assert.deepEqual(at(0.1), { threshold: 0.1, answerableKept: 1, unanswerableCaught: 0 });
  assert.deepEqual(at(0.15), { threshold: 0.15, answerableKept: 0.5, unanswerableCaught: 0 });
  assert.deepEqual(at(0.35), { threshold: 0.35, answerableKept: 0.5, unanswerableCaught: 1 });
  assert.deepEqual(r.retries, { questions: 2, helped: 1 });
});

test('results: answer totals; partial is not correct; an answered unanswerable is not refused', () => {
  const [anchor, hybrid] = publicResults({ answers, dataset }).answers.modes;
  assert.deepEqual([anchor.label, anchor.correct, anchor.accuracy, anchor.answered, anchor.accuracyOnAnswered, anchor.refused, anchor.unanswerable],
    ['Anchor', 1, 0.5, 2, 0.5, 1, 1]);
  assert.deepEqual([hybrid.correct, hybrid.accuracy, hybrid.answered, hybrid.refused, hybrid.citedRightPage], [1, 0.5, 1, 0, 0]);
});

test('results: ungraded runs give null accuracy instead of 0', () => {
  const ungraded = { ...answers, grading: undefined, rows: answers.rows.map(({ correctness, ...r }) => r) };
  const a = publicResults({ answers: ungraded, dataset }).answers;
  assert.equal(a.gradedBy, null);
  assert.equal(a.modes[0].accuracy, null);
});

test('results: visitor ratings are passed through as their own part, apart from the measured numbers', () => {
  const feedback = { rated: 3, up: 2, down: 1, helpfulRate: 2 / 3 };
  const r = publicResults({ answers, dataset, feedback });
  assert.deepEqual(r.feedback, feedback);
  assert.equal(r.answers.modes[0].accuracy, 0.5); // unchanged by the ratings
  assert.equal(publicResults({ answers, dataset }).feedback, null);
});

test('results: nothing from the questions, answers or passages is sent', () => {
  const text = JSON.stringify(publicResults({ retrieval, answers, dataset }));
  for (const secret of ['secret question text', 'secret answer', 'secret generated answer', 'secret passage']) assert.ok(!text.includes(secret), secret);
});

test('results: loads the newest finished run files of the dataset', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'anchor-results-'));
  const results = path.join(dir, 'results');
  const datasets = path.join(dir, 'datasets');
  await mkdir(results);
  await mkdir(datasets);
  await writeFile(path.join(datasets, 'tiny.json'), JSON.stringify(dataset));
  await writeFile(path.join(results, 'tiny-retrieval-2026-01-01.json'), JSON.stringify(retrieval));
  await writeFile(path.join(results, 'tiny-retrieval-2026-02-01.partial.json'), '{ not finished');
  await writeFile(path.join(results, 'tiny-answers-2026-01-02.json'), JSON.stringify(answers));
  const r = await loadResults('tiny', { dir: results, datasetsDir: datasets });
  assert.equal(r.dataset.questions, 3);
  assert.equal(r.retrieval.measuredAt, retrieval.startedAt);
  assert.equal(r.answers.modes.length, 2);
  assert.equal(await loadResults('other', { dir: results, datasetsDir: datasets }), null);
});
