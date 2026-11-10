// Fits the evidence gate's coefficients (src/lib/gate.js) from saved retrieval runs and
// writes the JSON file the server reads. Fits on the TUNING split only (eval/split.js);
// the test split is never read here.
//   node eval/fit-gate.js eval/datasets/real.json [--runs a.json,b.json] [--out <file>] [--lambda 1]
// --runs defaults to every finished retrieval run of this dataset in eval/results/.
// The runs must come from a server with confidence signals on (the default) and from
// configs that rerank (hybrid+rerank, anchor-noretry, anchor-static, anchor). No API calls.
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { parseArgs } from 'util';
import { config } from '../src/config.js';
import { gateZone } from '../src/lib/gate.js';
import { RESULTS_DIR, loadDataset, round } from './common.js';
import { assignSplits } from './split.js';
import { fitGate, gateExamples } from './logreg.js';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: 'string' },
    out: { type: 'string', default: config.gate.file },
    lambda: { type: 'string', default: '1' },
  },
});

async function loadRuns(dataset) {
  const files = args.runs
    ? args.runs.split(',').map((f) => path.resolve(f.trim()))
    : (await readdir(RESULTS_DIR).catch(() => []))
      .filter((f) => f.endsWith('.json') && !f.endsWith('.partial.json'))
      .map((f) => path.join(RESULTS_DIR, f));
  const runs = [];
  for (const file of files) {
    const run = JSON.parse(await readFile(file, 'utf8'));
    if ((run.kind ?? 'retrieval') === 'retrieval' && run.dataset === dataset) runs.push({ file, ...run });
  }
  return runs;
}

async function main() {
  if (!positionals[0]) throw new Error('usage: node eval/fit-gate.js <dataset.json> [--runs a.json,b.json] [--out file] [--lambda 1]');
  const { dataset } = await loadDataset(positionals[0]);
  const runs = await loadRuns(dataset.name);
  if (!runs.length) throw new Error(`No retrieval runs of ${dataset.name} found. Run eval/run.js first (with a reranking config).`);

  const splits = assignSplits(dataset.questions);
  const { examples, skipped } = gateExamples(runs.flatMap((r) => r.rows), splits);
  console.log(`${runs.length} run(s); tuning attempts used: ${examples.length}; left out: ${skipped.notTuning} from the test split, `
    + `${skipped.noSignals} without signals or label, ${skipped.duplicates} duplicates`);

  const model = fitGate(examples, {
    lambda: Number(args.lambda),
    info: { dataset: dataset.name, runs: runs.map((r) => r.startedAt) },
  });
  if (examples.length < 20) {
    console.warn(`Warning: only ${examples.length} examples. The coefficients will be unstable; treat them as a harness check.`);
  }

  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(model, null, 2)}\n`);

  console.table(model.features.map((f, j) => ({ feature: f, weight: round(model.weights[j]), mean: round(model.mean[j]), std: round(model.std[j]) })));
  const zones = { high: 0, middle: 0, low: 0 };
  for (const e of examples) {
    // Re-create the signals' probability from the stored feature vector
    const z = e.x.reduce((a, v, j) => a + model.weights[j] * ((v - model.mean[j]) / model.std[j]), model.intercept);
    zones[gateZone(1 / (1 + Math.exp(-z)), config.gate)] += 1;
  }
  console.log(`intercept ${round(model.intercept)}, training log loss ${round(model.fit.trainLogLoss)} `
    + `(${model.fit.positives}/${model.fit.examples} examples had the gold page)`);
  console.log(`Tuning attempts per zone at cut-offs ${config.gate.low}/${config.gate.high}: `
    + `high ${zones.high}, middle ${zones.middle}, low ${zones.low}`);
  console.log('These are training numbers on the tuning split, not results. Measure on the test split (eval/run.js --split test, then eval/report.js).');
  console.log(`Wrote ${path.relative(process.cwd(), args.out)}. Turn the gate on with EVIDENCE_GATE=true or "gate": true in a request.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
