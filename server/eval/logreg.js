import { GATE_FEATURES, featureVector, sigmoid } from '../src/lib/gate.js';

// L2-regularised logistic regression, fitted by batch gradient descent on standardised
// features. Small and deterministic on purpose: the gate has five features and the
// tuning split a few dozen examples, and two of the features (top score, top-3 mean)
// move together, so the penalty keeps the weights from blowing up.
// X: rows of numbers, y: 0/1. Returns { weights, intercept, mean, std, logLoss }.
export function fitLogistic(X, y, { lambda = 1, iterations = 5000, learningRate = 0.1 } = {}) {
  const n = X.length;
  const d = X[0].length;
  const mean = Array.from({ length: d }, (_, j) => X.reduce((a, x) => a + x[j], 0) / n);
  // A feature that never varies carries no information: std 1 leaves it at zero
  const std = mean.map((m, j) => Math.sqrt(X.reduce((a, x) => a + (x[j] - m) ** 2, 0) / n) || 1);
  const Z = X.map((x) => x.map((v, j) => (v - mean[j]) / std[j]));

  const weights = Array(d).fill(0);
  let intercept = 0;
  const predict = (z) => sigmoid(z.reduce((a, v, j) => a + weights[j] * v, intercept));
  for (let it = 0; it < iterations; it++) {
    const gradW = Array(d).fill(0);
    let gradB = 0;
    Z.forEach((z, i) => {
      const err = predict(z) - y[i];
      gradB += err;
      for (let j = 0; j < d; j++) gradW[j] += err * z[j];
    });
    for (let j = 0; j < d; j++) weights[j] -= learningRate * ((gradW[j] + lambda * weights[j]) / n);
    intercept -= learningRate * (gradB / n); // the intercept is not penalised
  }

  const clamp = (p) => Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  const logLoss = -Z.reduce((a, z, i) => {
    const p = clamp(predict(z));
    return a + (y[i] ? Math.log(p) : Math.log(1 - p));
  }, 0) / n;
  return { weights, intercept, mean, std, logLoss };
}

// Training examples for the gate from retrieval-run rows (eval/run.js): one per logged
// attempt, features = its confidence signals, label = whether that attempt's hits held a
// gold page (false for unanswerable questions). ONLY questions in the tuning split are
// used. The same attempt logged by several configs counts once.
// rows: eval rows with `attempts`; splits: Map(id -> 'tune' | 'test') from eval/split.js.
export function gateExamples(rows, splits) {
  const seen = new Set();
  const examples = [];
  const skipped = { notTuning: 0, noSignals: 0, duplicates: 0 };
  for (const row of rows) {
    if (row.error || !row.attempts?.length) continue;
    if (splits.get(row.id) !== 'tune') {
      skipped.notTuning += row.attempts.length;
      continue;
    }
    for (const a of row.attempts) {
      if (!a.signals || typeof a.goldRetrieved !== 'boolean') {
        skipped.noSignals += 1;
        continue;
      }
      const key = JSON.stringify([row.id, a.query, a.signals]);
      if (seen.has(key)) {
        skipped.duplicates += 1;
        continue;
      }
      seen.add(key);
      examples.push({ id: row.id, x: featureVector(a.signals), y: a.goldRetrieved ? 1 : 0 });
    }
  }
  return { examples, skipped };
}

// examples -> the coefficients file's content. Refuses a set it cannot learn from.
export function fitGate(examples, { lambda = 1, info = {} } = {}) {
  const positives = examples.filter((e) => e.y === 1).length;
  if (!examples.length) throw new Error('No tuning-split attempts with confidence signals and a gold label');
  if (positives === 0 || positives === examples.length) {
    throw new Error(`All ${examples.length} tuning examples have the same label (${positives ? 'gold retrieved' : 'gold not retrieved'}); a gate cannot be fitted on one class`);
  }
  const { weights, intercept, mean, std, logLoss } = fitLogistic(examples.map((e) => e.x), examples.map((e) => e.y), { lambda });
  return {
    version: 1,
    features: GATE_FEATURES,
    weights, intercept, mean, std,
    fit: {
      ...info,
      split: 'tune',
      label: 'goldRetrieved',
      examples: examples.length,
      positives,
      questions: new Set(examples.map((e) => e.id)).size,
      lambda,
      trainLogLoss: logLoss,
      createdAt: new Date().toISOString(),
    },
  };
}
