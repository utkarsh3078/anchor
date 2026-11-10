import { readFileSync, statSync } from 'fs';
import { config } from '../config.js';

// Evidence gate: turns an attempt's confidence signals (lib/signals.js) into one
// probability that the retrieved passages hold the answer, with a logistic regression
// whose coefficients are fitted offline (eval/fit-gate.js) and read from a JSON file.
// The probability falls in one of three zones:
//   high   (p >= high)        answer
//   low    (p <  low)         retry, and abstain if no attempt does better
//   middle (low <= p < high)  ask Gemini whether the passages are sufficient (lib/sufficiency.js)
// Without a coefficients file there is no gate and the fixed threshold decides, as before.

export const GATE_FEATURES = ['topScore', 'top2Gap', 'top3Mean', 'overlap10', 'topInBoth'];

// Signals as numbers, in GATE_FEATURES order. A single reranked passage has no gap (0)
// and its top-3 mean is its own score; overlap is scaled to 0-1.
export function featureVector(s) {
  return [s.topScore, s.top2Gap ?? 0, s.top3Mean ?? s.topScore, s.overlap10 / 10, s.topInBoth ? 1 : 0];
}

export const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// model: { weights, intercept, mean, std } over standardised features
export function gateProbability(model, signals) {
  const x = featureVector(signals);
  return sigmoid(x.reduce((z, v, j) => z + model.weights[j] * ((v - model.mean[j]) / model.std[j]), model.intercept));
}

export const gateZone = (p, { low, high }) => {
  if (p >= high) return 'high';
  return p < low ? 'low' : 'middle';
};

const numbers = (xs) => Array.isArray(xs) && xs.length === GATE_FEATURES.length && xs.every(Number.isFinite);

export function isGateModel(m) {
  return Boolean(m) && Number.isFinite(m.intercept) && numbers(m.weights) && numbers(m.mean)
    && numbers(m.std) && m.std.every((s) => s > 0)
    && JSON.stringify(m.features) === JSON.stringify(GATE_FEATURES);
}

// The fitted model, or null when the file is missing or unusable. Re-read when the file
// changes, so a new fit applies without restarting the server.
let loaded = { file: null, mtimeMs: null, model: null };
export function loadGateModel(file = config.gate.file) {
  let mtimeMs;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return null; // no coefficients file: the caller falls back to the threshold
  }
  if (loaded.file === file && loaded.mtimeMs === mtimeMs) return loaded.model;
  let model = null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (isGateModel(parsed)) model = parsed;
    else console.error(`Evidence gate: ${file} is not a valid coefficients file; using the threshold instead`);
  } catch (e) {
    console.error(`Evidence gate: cannot read ${file} (${e.message}); using the threshold instead`);
  }
  loaded = { file, mtimeMs, model };
  return model;
}
