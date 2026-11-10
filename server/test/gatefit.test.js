import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY ||= 'test';
const { assignSplits, questionsIn, splitCounts } = await import('../eval/split.js');
const { fitLogistic, gateExamples, fitGate } = await import('../eval/logreg.js');
const { isGateModel, gateProbability } = await import('../src/lib/gate.js');

const question = (id, answerable = true, category = 'exact', extra = {}) => ({ id, answerable, category, ...extra });
const dataset = {
  questions: [
    ...Array.from({ length: 6 }, (_, i) => question(`e${i}`)),
    ...Array.from({ length: 5 }, (_, i) => question(`p${i}`, true, 'paraphrase')),
    ...Array.from({ length: 4 }, (_, i) => question(`u${i}`, false, 'unanswerable')),
  ],
};

test('assignSplits: halves each kind of question, the same way every time', () => {
  const a = assignSplits(dataset.questions);
  const b = assignSplits([...dataset.questions].reverse());
  assert.deepEqual([...a].sort(), [...b].sort()); // order of the file doesn't matter
  const counts = splitCounts(dataset.questions);
  assert.deepEqual(counts['answerable/exact'], { tune: 3, test: 3 });
  assert.deepEqual(counts['unanswerable/unanswerable'], { tune: 2, test: 2 });
  const p = counts['answerable/paraphrase'];
  assert.equal(Math.abs(p.tune - p.test), 1);
  const total = Object.values(counts).reduce((t, c) => ({ tune: t.tune + c.tune, test: t.test + c.test }), { tune: 0, test: 0 });
  assert.ok(Math.abs(total.tune - total.test) <= 1);
});

test('assignSplits: a stored split wins and new questions fill the smaller half', () => {
  const fixed = [question('a', true, 'exact', { split: 'test' }), question('b', true, 'exact', { split: 'test' }), question('c'), question('d')];
  const s = assignSplits(fixed);
  assert.deepEqual([s.get('a'), s.get('b'), s.get('c'), s.get('d')], ['test', 'test', 'tune', 'tune']);
  assert.throws(() => assignSplits([question('x', true, 'exact', { split: 'dev' })]), /split must be/);
});

test('questionsIn: tune and test are disjoint and cover the dataset', () => {
  const tune = questionsIn(dataset, 'tune').map((q) => q.id);
  const test_ = questionsIn(dataset, 'test').map((q) => q.id);
  assert.equal(tune.filter((id) => test_.includes(id)).length, 0);
  assert.equal(tune.length + test_.length, dataset.questions.length);
  assert.equal(questionsIn(dataset, 'all').length, dataset.questions.length);
  assert.throws(() => questionsIn(dataset, 'dev'), /split must be/);
});

test('fitLogistic: learns which feature separates the classes', () => {
  // y depends on x0 only; x1 is noise; x2 never varies
  const X = [];
  const y = [];
  for (let i = 0; i < 40; i++) {
    const x0 = i / 40;
    X.push([x0, (i * 7) % 5, 3]);
    y.push(x0 > 0.5 ? 1 : 0);
  }
  const m = fitLogistic(X, y, { lambda: 0.1 });
  assert.ok(m.weights[0] > 1, `weight ${m.weights[0]}`);
  assert.ok(Math.abs(m.weights[1]) < Math.abs(m.weights[0]) / 4);
  assert.equal(m.weights[2], 0);
  assert.equal(m.std[2], 1); // constant feature: no division by zero
  const predict = (x) => 1 / (1 + Math.exp(-x.reduce((a, v, j) => a + m.weights[j] * ((v - m.mean[j]) / m.std[j]), m.intercept)));
  const correct = X.filter((x, i) => (predict(x) >= 0.5 ? 1 : 0) === y[i]).length;
  assert.ok(correct >= 38, `${correct}/40`);
  assert.ok(m.logLoss < 0.4);
});

test('fitLogistic: a stronger penalty shrinks the weights; the same input gives the same output', () => {
  const X = Array.from({ length: 20 }, (_, i) => [i / 20, 1 - i / 20]);
  const y = X.map((x) => (x[0] > 0.5 ? 1 : 0));
  const weak = fitLogistic(X, y, { lambda: 0.01 });
  const strong = fitLogistic(X, y, { lambda: 20 });
  assert.ok(Math.abs(strong.weights[0]) < Math.abs(weak.weights[0]));
  assert.deepEqual(fitLogistic(X, y, { lambda: 1 }), fitLogistic(X, y, { lambda: 1 }));
});

const sig = (topScore) => ({ topScore, top2Gap: topScore / 2, top3Mean: topScore * 0.8, overlap10: Math.round(topScore * 6), topInBoth: topScore > 0.4 });
const row = (id, attempts, extra = {}) => ({ config: 'anchor-noretry', id, attempts, ...extra });
const attempt = (query, topScore, goldRetrieved) => ({ attempt: 0, query, signals: sig(topScore), goldRetrieved });

test('gateExamples: only tuning-split questions, one example per distinct attempt', () => {
  const splits = new Map([['t1', 'tune'], ['t2', 'tune'], ['x1', 'test']]);
  const rows = [
    row('t1', [attempt('q', 0.8, true), attempt('q again', 0.6, true)]),
    row('t1', [attempt('q', 0.8, true)], { config: 'anchor' }), // the same attempt from another config
    row('t2', [attempt('q', 0.1, false)]),
    row('x1', [attempt('q', 0.9, true)]), // test split: never used
    row('t2', [{ attempt: 0, query: 'q', signals: null, goldRetrieved: false }]), // signals were off
    row('t2', [], { error: 'boom' }),
    { config: 'dense', id: 't1' }, // no rerank, no attempts
  ];
  const { examples, skipped } = gateExamples(rows, splits);
  assert.deepEqual(examples.map((e) => [e.id, e.y]), [['t1', 1], ['t1', 1], ['t2', 0]]);
  assert.equal(examples.some((e) => e.id === 'x1'), false);
  assert.deepEqual(skipped, { notTuning: 1, noSignals: 1, duplicates: 1 });
  assert.equal(examples[0].x.length, 5);
});

test('fitGate: writes a model the server accepts and that ranks strong evidence higher', () => {
  const examples = [0.9, 0.8, 0.75, 0.7, 0.6, 0.3, 0.2, 0.15, 0.1, 0.05].map((s, i) => ({ id: `q${i}`, x: [s, s / 2, s * 0.8, 0.5, 1], y: s >= 0.6 ? 1 : 0 }));
  const model = fitGate(examples, { lambda: 0.5, info: { dataset: 'unit' } });
  assert.equal(isGateModel(model), true);
  assert.deepEqual([model.fit.split, model.fit.label, model.fit.examples, model.fit.positives, model.fit.questions, model.fit.dataset], ['tune', 'goldRetrieved', 10, 5, 10, 'unit']);
  assert.ok(gateProbability(model, sig(0.9)) > gateProbability(model, sig(0.1)));
});

test('fitGate: refuses an empty or one-class tuning set', () => {
  assert.throws(() => fitGate([]), /No tuning-split attempts/);
  assert.throws(() => fitGate([{ id: 'a', x: [1, 0, 1, 0, 0], y: 1 }, { id: 'b', x: [0.9, 0, 1, 0, 0], y: 1 }]), /same label/);
});
