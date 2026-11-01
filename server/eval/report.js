// Builds the paper's tables as Markdown from saved eval runs (latest of each kind).
//   node eval/report.js [--dataset smoke] [--source mongo|files] [--out report.md]
// Source defaults to MongoDB when MONGODB_URI is set, else eval/results/*.json.
import { readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { parseArgs } from 'util';
import { collection, closeDb, mongoEnabled } from '../src/lib/db.js';
import { RESULTS_DIR } from './common.js';
import { gateCurve, mean } from './metrics.js';

const { values: args } = parseArgs({
  options: {
    dataset: { type: 'string' },
    source: { type: 'string', default: mongoEnabled() ? 'mongo' : 'files' },
    out: { type: 'string' },
  },
});

const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const dec = (x) => (x == null ? '–' : x.toFixed(3));
const msf = (x) => (x == null ? '–' : `${x}`);

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

async function loadRuns() {
  if (args.source === 'mongo') {
    const col = await collection('evalRuns');
    const runs = await col.find({}, { projection: { _id: 0 } }).sort({ startedAt: 1 }).toArray();
    await closeDb();
    return runs.map((r) => ({ ...r, startedAt: new Date(r.startedAt).toISOString() }));
  }
  const files = (await readdir(RESULTS_DIR).catch(() => [])).filter((f) => f.endsWith('.json'));
  const runs = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(RESULTS_DIR, f), 'utf8'))));
  // Runs saved before `kind` existed were retrieval runs
  return runs.map((r) => ({ kind: 'retrieval', ...r })).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function retrievalSection(run) {
  const k = run.settings.k;
  const out = [`## Retrieval (${run.dataset}, k=${k}, ${run.startedAt})`, ''];
  out.push(table(
    ['Config', `Recall@${k}`, 'MRR', 'p50 ms', 'p95 ms', 'Answerable kept', 'Unanswerable caught', 'Retry rate', 'Retry precision', 'Errors'],
    run.summary.map((s) => [s.config, dec(s.recall), dec(s.mrr), msf(s.latencyP50), msf(s.latencyP95),
      pct(s.answeredRate), pct(s.abstainRate), pct(s.retryRate), pct(s.retryPrecision), s.errors]),
  ));

  const rows = run.rows.filter((r) => !r.error && r.answerable);
  const categories = [...new Set(rows.map((r) => r.category ?? 'none'))];
  if (categories.length > 1) {
    out.push('', `### Recall@${k} by category`, '');
    out.push(table(['Config', ...categories], run.summary.map((s) => [s.config, ...categories.map((c) => {
      const xs = rows.filter((r) => r.config === s.config && (r.category ?? 'none') === c).map((r) => r.recall);
      return xs.length ? `${dec(mean(xs))} (n=${xs.length})` : '–';
    })])));
  }

  // First-attempt scores without retry are exactly what a threshold is applied to.
  // A sweep has one anchor-noretry run per threshold with the same scores; use the first.
  const noRetry = run.rows.filter((r) => (r.base ?? r.config) === 'anchor-noretry');
  const gateRows = noRetry
    .filter((r) => !r.error && r.config === noRetry[0].config)
    .map((r) => ({ answerable: r.answerable, score: r.firstTopScore ?? r.topScore }));
  if (gateRows.length) {
    const thresholds = Array.from({ length: 12 }, (_, i) => Math.round((i + 1) * 0.05 * 100) / 100);
    out.push('', '### Confidence gate (anchor-noretry first-attempt scores)', '');
    out.push(table(['Threshold', 'Answerable kept', 'Unanswerable caught'],
      gateCurve(gateRows, thresholds).map((g) => [g.threshold, pct(g.answeredRate), pct(g.abstainRate)])));
  }
  return out.join('\n');
}

function answersSection(run) {
  const out = [`## Answers (${run.dataset}, k=${run.settings.k}, judge: ${run.settings.judge ? 'on' : 'off'}, ${run.startedAt})`, ''];
  out.push(table(
    ['Mode', 'Accuracy', 'Answerable answered', 'Unanswerable abstained', 'Citation precision', 'Cited gold page', 'Faithful (supported)', 'p50 ms', 'p95 ms', 'Errors'],
    run.summary.map((s) => [s.mode, pct(s.accuracy), pct(s.answeredRate), pct(s.abstainRate), pct(s.citationPrecision),
      pct(s.citedGoldRate), pct(s.faithfulness?.supported), msf(s.latencyP50), msf(s.latencyP95), s.errors]),
  ));
  out.push('', 'Accuracy counts abstentions on answerable questions as wrong. Judge: '
    + `${run.rows.find((r) => r.judgeModel)?.judgeModel ?? 'n/a'} (an LLM grading its own family; verify a sample by hand).`);
  return out.join('\n');
}

async function main() {
  const runs = await loadRuns();
  if (!runs.length) throw new Error(`No eval runs found (source: ${args.source})`);
  const dataset = args.dataset ?? runs.at(-1).dataset;
  const latest = (kind) => runs.filter((r) => r.dataset === dataset && r.kind === kind).at(-1);

  const sections = [`# Anchor evaluation: ${dataset}`];
  const retrieval = latest('retrieval');
  const answers = latest('answers');
  if (retrieval) sections.push(retrievalSection(retrieval));
  if (answers) sections.push(answersSection(answers));
  if (!retrieval && !answers) throw new Error(`No runs for dataset ${dataset}`);

  const md = `${sections.join('\n\n')}\n`;
  if (args.out) {
    await writeFile(args.out, md);
    console.log(`Wrote ${args.out}`);
  } else {
    console.log(md);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
