import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionMetrics, riskCoverage, riskCoverageAt, aurc } from '../eval/metrics.js';
import { CONFIGS } from '../eval/configs.js';

const q = (answerable, answered, correct = null) => ({ answerable, answered, correct });

test('decisionMetrics: the four rates', () => {
  const rows = [
    q(true, true, true), q(true, true, true), q(true, true, false), // answerable, answered
    q(true, false), // answerable, abstained: a false abstention
    q(false, true, false), // unanswerable but answered: wrong
    q(false, false), q(false, false), q(false, false), // unanswerable, rejected
  ];
  const d = decisionMetrics(rows);
  assert.equal(d.n, 8);
  assert.equal(d.answerRate, 4 / 8);
  assert.equal(d.accuracyOnAnswered, 2 / 4);
  assert.equal(d.unanswerableRejection, 3 / 4);
  assert.equal(d.falseAbstention, 1 / 4);
  assert.equal(d.ungraded, 0);
});

test('decisionMetrics: ungraded answers are left out of accuracy and counted', () => {
  const d = decisionMetrics([q(true, true, true), q(true, true, null), q(true, true, null)]);
  assert.equal(d.accuracyOnAnswered, 1);
  assert.equal(d.ungraded, 2);
});

test('decisionMetrics: nothing answered, or no unanswerable questions, gives null not 0', () => {
  const d = decisionMetrics([q(true, false), q(true, false)]);
  assert.deepEqual([d.answerRate, d.accuracyOnAnswered, d.unanswerableRejection, d.falseAbstention], [0, null, null, 1]);
});

const scored = [
  { score: 0.9, correct: true }, { score: 0.8, correct: true }, { score: 0.6, correct: false },
  { score: 0.6, correct: true }, { score: 0.2, correct: false },
];

test('riskCoverageAt: answers at or above the cut-off', () => {
  assert.deepEqual(riskCoverageAt(scored, 0.7), { cutoff: 0.7, answered: 2, coverage: 0.4, risk: 0 });
  assert.deepEqual(riskCoverageAt(scored, 0.6), { cutoff: 0.6, answered: 4, coverage: 0.8, risk: 0.25 });
  assert.deepEqual(riskCoverageAt(scored, 0.95), { cutoff: 0.95, answered: 0, coverage: 0, risk: null });
});

test('riskCoverage: one point per distinct score, strictest first; ties enter together', () => {
  const curve = riskCoverage(scored);
  assert.deepEqual(curve.map((p) => [p.cutoff, p.answered]), [[0.9, 1], [0.8, 2], [0.6, 4], [0.2, 5]]);
  assert.equal(curve.at(-1).risk, 2 / 5);
});

test('riskCoverage: a question the answer step refuses is never answered but still counts for coverage', () => {
  const rows = [{ score: 0.9, correct: true }, { score: 0.8, correct: false, passes: false }, { score: 0.1, correct: false }];
  assert.deepEqual(riskCoverageAt(rows, 0.5), { cutoff: 0.5, answered: 1, coverage: 1 / 3, risk: 0 });
  assert.deepEqual(riskCoverageAt(rows, 0), { cutoff: 0, answered: 2, coverage: 2 / 3, risk: 0.5 });
});

test('aurc: lower when the score ranks correct answers above wrong ones', () => {
  const good = [{ score: 0.9, correct: true }, { score: 0.8, correct: true }, { score: 0.3, correct: false }, { score: 0.2, correct: false }];
  const bad = good.map((r, i) => ({ ...r, score: [0.2, 0.3, 0.8, 0.9][i] }));
  assert.equal(aurc(good), (0 + 0 + 1 / 3 + 2 / 4) / 4);
  assert.equal(aurc(bad), (1 + 1 + 2 / 3 + 2 / 4) / 4);
  assert.ok(aurc(good) < aurc(bad));
  assert.equal(aurc([]), null);
  assert.equal(aurc([{ score: 0.5, correct: true, passes: false }]), null);
});

test('aurc: tied scores are admitted as one step', () => {
  const rows = [{ score: 0.5, correct: true }, { score: 0.5, correct: false }];
  assert.equal(aurc(rows), 0.5);
});

test('configs: the new ones exist and every reranking config pins fusion and gate', () => {
  assert.deepEqual(CONFIGS['hybrid-convex'].body, { fusion: 'convex' });
  assert.deepEqual([CONFIGS['anchor-gate'].body.gate, CONFIGS['anchor-gate'].body.sufficiencyCheck], [true, false]);
  assert.deepEqual([CONFIGS['anchor-gate+check'].body.gate, CONFIGS['anchor-gate+check'].body.sufficiencyCheck], [true, true]);
  for (const name of ['anchor-noretry', 'anchor-static', 'anchor']) {
    assert.deepEqual([CONFIGS[name].body.gate, CONFIGS[name].body.fusion], [false, 'rrf']);
  }
  for (const name of ['hybrid', 'hybrid+route', 'hybrid+rerank', 'anchor-gate', 'anchor-gate+check']) {
    assert.equal(CONFIGS[name].body.fusion, 'rrf');
  }
});
