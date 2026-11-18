import test from 'node:test';
import assert from 'node:assert/strict';
import { duration, headline, nearest, pct, pipelineSteps, pointsGained, thresholdGeometry } from '../lib/results.js';

test('pct and duration: plain numbers for the page', () => {
  assert.equal(pct(0.965), '96.5%');
  assert.equal(pct(0.94), '94%');
  assert.equal(pct(1), '100%');
  assert.equal(pct(null), '–');
  assert.equal(duration(0), 'under 1 ms');
  assert.equal(duration(430), '430 ms');
  assert.equal(duration(1314), '1.3 s');
});

test('pointsGained: signed percentage points, nothing when equal', () => {
  assert.equal(pointsGained(0.897, 0.965), '+6.8 pts');
  assert.equal(pointsGained(0.9, 0.85), '−5.0 pts');
  assert.equal(pointsGained(0.965, 0.965), null);
  assert.equal(pointsGained(null, 0.5), null);
});

test('pipelineSteps: single searches get no gain; later steps are compared with the best before them', () => {
  const steps = pipelineSteps([
    { config: 'dense', recall: 0.897, mrr: 0.867 },
    { config: 'bm25', recall: 0.901, mrr: 0.843 },
    { config: 'hybrid', recall: 0.965, mrr: 0.881 },
    { config: 'hybrid+rerank', recall: 0.965, mrr: 0.933 },
  ]);
  assert.deepEqual(steps.map((s) => [s.recallGain, s.mrrGain]), [
    [null, null], [null, null], ['+6.4 pts', '+1.4 pts'], [null, '+5.2 pts'],
  ]);
});

const results = {
  retrieval: { k: 5, configs: [{ config: 'dense', recall: 0.9 }, { config: 'anchor', recall: 0.965 }] },
  answers: { modes: [{ mode: 'hybrid' }, { mode: 'anchor-soft', accuracy: 0.942, correct: 49, answerable: 52, refused: 10, unanswerable: 10, citedRightPage: 1 }] },
};

test('headline: Anchor answer accuracy, page found by full Anchor, refusals, citations', () => {
  const tiles = headline(results);
  assert.deepEqual(tiles.map((t) => [t.key, t.value]), [['accuracy', 0.942], ['found', 0.965], ['refused', 1], ['cited', 1]]);
  assert.match(tiles[0].detail, /49 of 52/);
  assert.deepEqual(tiles[2].fraction, [10, 10]);
});

test('headline: without an answer run or without grades, those tiles are left out', () => {
  assert.deepEqual(headline({ retrieval: results.retrieval }).map((t) => t.key), ['found']);
  const ungraded = { ...results, answers: { modes: [{ mode: 'anchor-soft', accuracy: null, refused: 3, unanswerable: 4, citedRightPage: 0.9 }] } };
  assert.deepEqual(headline(ungraded).map((t) => t.key), ['found', 'refused', 'cited']);
});

test('thresholdGeometry: paths run left to right, 100% at the top; nearest snaps', () => {
  const g = thresholdGeometry([
    { threshold: 0.1, answerableKept: 1, unanswerableCaught: 0 },
    { threshold: 0.3, answerableKept: 0.5, unanswerableCaught: 1 },
  ], { width: 200, height: 100, pad: { top: 0, right: 0, bottom: 0, left: 0 } });
  assert.equal(g.kept, 'M0.0,0.0 L200.0,50.0');
  assert.equal(g.caught, 'M0.0,100.0 L200.0,0.0');
  assert.equal(nearest(g.positions, 150).threshold, 0.3);
  assert.equal(nearest(g.positions, 20).threshold, 0.1);
  assert.equal(thresholdGeometry([], { width: 10, height: 10 }), null);
});

import { FEW_RATINGS, nextRating, ratingsSummary } from '../lib/feedback.js';

test('nextRating: a second click on the same thumb takes the rating back', () => {
  assert.equal(nextRating(null, 'up'), 'up');
  assert.equal(nextRating('up', 'down'), 'down');
  assert.equal(nextRating('down', 'down'), null);
});

test('ratingsSummary: answers only, refusals reported apart, too-few flagged', () => {
  assert.equal(ratingsSummary(null), null);
  const none = ratingsSummary({ answers: { rated: 0, up: 0, down: 0, helpfulRate: null }, refusals: { rated: 0, up: 0, down: 0 } });
  assert.deepEqual([none.state, none.rate, none.refusals], ['none', null, null]);
  const few = ratingsSummary({ answers: { rated: 3, up: 2, down: 1, helpfulRate: 2 / 3 }, refusals: { rated: 1, up: 0, down: 1 } });
  assert.deepEqual([few.state, few.helpful, few.notHelpful], ['few', 2, 1]);
  assert.equal(few.refusals, '“Not in your document” replies were rated 1 time: 0 helpful, 1 not.');
  assert.equal(ratingsSummary({ answers: { rated: FEW_RATINGS, up: 15, down: 5, helpfulRate: 0.75 } }).state, 'enough');
});
