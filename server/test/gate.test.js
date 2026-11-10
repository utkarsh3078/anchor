import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

process.env.GEMINI_API_KEY ||= 'test';
process.env.TYPESENSE_API_KEY ||= 'test';
const {
  GATE_FEATURES, featureVector, gateProbability, gateZone, isGateModel, loadGateModel,
} = await import('../src/lib/gate.js');
const { anchorRetrieve } = await import('../src/lib/anchor.js');
const { contextSufficient } = await import('../src/lib/sufficiency.js');
const { parseGateOptions, parseAnchorOptions } = await import('../src/routes/common.js');
const { attemptLog } = await import('../src/lib/signals.js');

// A hand-made model: only the top score matters, p = sigmoid(10 * (topScore - 0.5))
const model = { version: 1, features: GATE_FEATURES, weights: [10, 0, 0, 0, 0], intercept: 0, mean: [0.5, 0, 0, 0, 0], std: [1, 1, 1, 1, 1] };
const signals = (topScore) => ({ topScore, top2Gap: 0.1, top3Mean: topScore, overlap10: 3, topInBoth: true });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('featureVector: order, scaling and the single-passage defaults', () => {
  assert.deepEqual(featureVector({ topScore: 0.8, top2Gap: 0.3, top3Mean: 0.5, overlap10: 4, topInBoth: true }), [0.8, 0.3, 0.5, 0.4, 1]);
  assert.deepEqual(featureVector({ topScore: 0.6, top2Gap: null, top3Mean: null, overlap10: 0, topInBoth: false }), [0.6, 0, 0.6, 0, 0]);
});

test('gateProbability: logistic of the standardised features', () => {
  close(gateProbability(model, signals(0.5)), 0.5);
  close(gateProbability(model, signals(0.7)), 1 / (1 + Math.exp(-2)));
  const scaled = { ...model, weights: [0, 0, 0, 2, 0], mean: [0, 0, 0, 0.2, 0], std: [1, 1, 1, 0.1, 1] };
  close(gateProbability(scaled, signals(0.1)), 1 / (1 + Math.exp(-2))); // overlap 3 -> 0.3 -> (0.3 - 0.2) / 0.1 = 1
});

test('gateZone: three zones, boundaries belong to the higher zone', () => {
  const cut = { low: 0.3, high: 0.7 };
  assert.deepEqual([0.1, 0.3, 0.5, 0.7, 0.9].map((p) => gateZone(p, cut)), ['low', 'middle', 'middle', 'high', 'high']);
  assert.deepEqual([0.49, 0.5].map((p) => gateZone(p, { low: 0.5, high: 0.5 })), ['low', 'high']); // no middle zone
});

test('loadGateModel: null without a file or with a bad one, re-read when the file changes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gate-'));
  const file = path.join(dir, 'gate.json');
  assert.equal(loadGateModel(file), null); // missing

  writeFileSync(file, '{not json');
  assert.equal(loadGateModel(file), null);

  writeFileSync(file, JSON.stringify({ ...model, weights: [1, 2] })); // wrong length
  utimesSync(file, new Date(), new Date(Date.now() + 2000));
  assert.equal(loadGateModel(file), null);

  writeFileSync(file, JSON.stringify(model));
  utimesSync(file, new Date(), new Date(Date.now() + 4000));
  assert.deepEqual(loadGateModel(file).weights, model.weights);
});

test('isGateModel: rejects other feature sets and zero spreads', () => {
  assert.equal(isGateModel(model), true);
  assert.equal(isGateModel({ ...model, features: ['topScore'] }), false);
  assert.equal(isGateModel({ ...model, std: [1, 1, 0, 1, 1] }), false);
  assert.equal(isGateModel(null), false);
});

// anchorRetrieve with a fake search whose signals depend on the query
const opts = { k: 3, docIds: [], candidates: 10, weights: 'auto', threshold: 0.5, maxRetries: 1 };
function fakeSearch(topScores) {
  const calls = [];
  return {
    calls,
    search: async (query) => {
      calls.push(query);
      const top = topScores[query];
      return { hits: [{ id: query, score: top }], latencyMs: 1, timings: {}, trace: {}, signals: signals(top) };
    },
  };
}
const gate = (extra = {}) => ({ model, low: 0.3, high: 0.7, sufficiency: true, ...extra });
const noCheck = async () => assert.fail('sufficiency check should not run');
const noRewrite = async () => assert.fail('should not reformulate');

test('gate, high zone: answers without a retry or a sufficiency check', async () => {
  const { search, calls } = fakeSearch({ q: 0.9 });
  const r = await anchorRetrieve('q', { ...opts, gate: gate() }, { search, reformulate: noRewrite, checkSufficiency: noCheck });
  assert.equal(calls.length, 1);
  assert.equal(r.confidence.confident, true);
  assert.deepEqual([r.confidence.gate.used, r.confidence.gate.zone, r.confidence.gate.sufficient], [true, 'high', null]);
  assert.deepEqual([r.confidence.gate.low, r.confidence.gate.high], [0.3, 0.7]);
});

test('gate, low zone: retries, then is not confident; no sufficiency check', async () => {
  const { search, calls } = fakeSearch({ q: 0.1, q2: 0.2 });
  const r = await anchorRetrieve('q', { ...opts, gate: gate() }, { search, reformulate: async () => 'q2', checkSufficiency: noCheck });
  assert.deepEqual(calls, ['q', 'q2']);
  assert.equal(r.confidence.confident, false);
  assert.equal(r.bestAttempt, 1); // the higher probability
  assert.equal(r.confidence.gate.zone, 'low');
});

test('gate, middle zone: one sufficiency call; "yes" answers without a retry', async () => {
  const { search, calls } = fakeSearch({ q: 0.5 });
  const checked = [];
  const checkSufficiency = async (question, hits, gemini) => { checked.push([question, hits.length, gemini]); return true; };
  const r = await anchorRetrieve('q', { ...opts, gate: gate(), gemini: 'ctx' }, { search, reformulate: noRewrite, checkSufficiency });
  assert.deepEqual(checked, [['q', 1, 'ctx']]);
  assert.equal(calls.length, 1);
  assert.equal(r.confidence.confident, true);
  assert.deepEqual([r.confidence.gate.zone, r.confidence.gate.sufficient], ['middle', true]);
});

test('gate, middle zone: "no" is treated like low (retry, then not confident)', async () => {
  const { search, calls } = fakeSearch({ q: 0.5, q2: 0.45 });
  let checks = 0;
  const r = await anchorRetrieve('q', { ...opts, gate: gate() }, { search, reformulate: async () => 'q2', checkSufficiency: async () => { checks += 1; return false; } });
  assert.deepEqual(calls, ['q', 'q2']);
  assert.equal(checks, 2); // each middle-zone attempt is checked on its own passages
  assert.equal(r.confidence.confident, false);
  assert.equal(r.bestAttempt, 0);
});

test('gate: a confident retry wins even with a lower probability than a rejected attempt', async () => {
  const { search } = fakeSearch({ q: 0.55, q2: 0.5 }); // both in the middle zone
  const answers = [false, true];
  const r = await anchorRetrieve('q', { ...opts, gate: gate() }, { search, reformulate: async () => 'q2', checkSufficiency: async () => answers.shift() });
  assert.equal(r.bestAttempt, 1);
  assert.equal(r.confidence.confident, true);
});

test('gate without the sufficiency check: the middle zone is not confident and costs no call', async () => {
  const { search } = fakeSearch({ q: 0.5 });
  const r = await anchorRetrieve('q', { ...opts, maxRetries: 0, gate: gate({ sufficiency: false }) }, { search, checkSufficiency: noCheck });
  assert.equal(r.confidence.confident, false);
  assert.deepEqual([r.confidence.gate.zone, r.confidence.gate.sufficient, r.confidence.gate.sufficiencyCheck], ['middle', null, false]);
});

test('gate on but no coefficients file: the threshold decides, and the result says so', async () => {
  const { search } = fakeSearch({ q: 0.6 });
  const r = await anchorRetrieve('q', { ...opts, gate: gate({ model: null }) }, { search, reformulate: noRewrite, checkSufficiency: noCheck });
  assert.equal(r.confidence.confident, true); // 0.6 >= threshold 0.5
  assert.deepEqual(r.confidence.gate, { used: false, reason: 'no_coefficients' });
  assert.equal('gate' in r.attempts[0], false);
});

test('gate on but attempts carry no signals: the threshold decides', async () => {
  const search = async (query) => ({ hits: [{ id: query, score: 0.2 }], latencyMs: 1, timings: {}, trace: {} });
  const r = await anchorRetrieve('q', { ...opts, maxRetries: 0, gate: gate() }, { search, checkSufficiency: noCheck });
  assert.equal(r.confidence.confident, false);
  assert.deepEqual(r.confidence.gate, { used: false, reason: 'no_signals' });
});

test('gate off: the result has no gate field (old shape)', async () => {
  const { search } = fakeSearch({ q: 0.9 });
  const r = await anchorRetrieve('q', opts, { search });
  assert.deepEqual(r.confidence, { topScore: 0.9, threshold: 0.5, confident: true });
});

test('attemptLog: stores each attempt\'s gate verdict', async () => {
  const { search } = fakeSearch({ q: 0.5 });
  const r = await anchorRetrieve('q', { ...opts, gate: gate() }, { search, checkSufficiency: async () => true });
  const [row] = attemptLog(r, 'q');
  assert.deepEqual(Object.keys(row), ['attempt', 'query', 'signals', 'gate']);
  assert.deepEqual([row.gate.zone, row.gate.sufficient], ['middle', true]);
});

const defaults = { enabled: false, low: 0.3, high: 0.7, sufficiency: true };
const withModel = { defaults, loadModel: () => model };

test('parseGateOptions: off by default, on per request or by config', () => {
  assert.equal(parseGateOptions({}, withModel), undefined);
  assert.deepEqual(parseGateOptions({ gate: true }, withModel), { model, low: 0.3, high: 0.7, sufficiency: true });
  assert.deepEqual(parseGateOptions({}, { ...withModel, defaults: { ...defaults, enabled: true } }).high, 0.7);
  assert.equal(parseGateOptions({ gate: false }, { ...withModel, defaults: { ...defaults, enabled: true } }), undefined);
});

test('parseGateOptions: cut-offs and the sufficiency check can be set per request', () => {
  const g = parseGateOptions({ gate: true, gateLow: 0.2, gateHigh: 0.9, sufficiencyCheck: false }, withModel);
  assert.deepEqual([g.low, g.high, g.sufficiency], [0.2, 0.9, false]);
  assert.equal(parseGateOptions({ gate: true }, { defaults, loadModel: () => null }).model, null);
});

test('parseGateOptions: rejects bad values', () => {
  for (const body of [{ gate: 'yes' }, { gate: true, gateLow: 0.8, gateHigh: 0.2 }, { gate: true, gateHigh: 1.5 }, { gate: true, sufficiencyCheck: 1 }]) {
    assert.throws(() => parseGateOptions(body, withModel), (e) => e.status === 400);
  }
});

test('parseAnchorOptions: carries the gate options', () => {
  const o = parseAnchorOptions({ gate: false });
  assert.deepEqual(Object.keys(o), ['weights', 'threshold', 'maxRetries', 'gate', 'fusion', 'alpha']);
  assert.equal(o.gate, undefined);
});

test('contextSufficient: one request on the rewrite model, JSON verdict, cached', async () => {
  const sent = [];
  const gemini = {
    rewriteModel: 'helper-model', model: 'answer-model', useCache: true,
    ai: { models: { generateContent: async (req) => { sent.push(req); return { text: '{"sufficient": true}' }; } } },
  };
  const hits = [{ id: 'suff_1', docName: 'd.pdf', page: 2, text: 'The pump is serviced yearly.' }];
  assert.equal(await contextSufficient('How often is the pump serviced?', hits, gemini), true);
  assert.equal(await contextSufficient('How often is the pump serviced?', hits, gemini), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].model, 'helper-model');
  assert.match(sent[0].contents, /\[1\] \(d\.pdf, p\.2\)\nThe pump is serviced yearly\./);

  const no = { ...gemini, useCache: false, ai: { models: { generateContent: async () => ({ text: '{"sufficient": false}' }) } } };
  assert.equal(await contextSufficient('Another question?', hits, no), false);
});
