// Builds the paper's tables as Markdown from saved eval runs (latest of each kind).
//   node eval/report.js [--dataset smoke] [--source mongo|files] [--out report.md]
//     [--split test|tune|all] [--data curves.json] [--gate <coefficients.json>] [--results <dir>]
// Source defaults to MongoDB when MONGODB_URI is set, else eval/results/*.json
// (--results reads another folder of run files).
// --split (default test) picks the half the answer/abstain tables and the coverage-risk
// curves are computed on: the gate and alpha are tuned on the other half. The first two
// tables (retrieval and answer summaries) always cover whatever their run covered.
// --data also writes every number of the new sections as JSON, for plotting.
// No API calls: the gate's probabilities are recomputed here from the logged signals.
import { readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { parseArgs } from 'util';
import { collection, closeDb, mongoEnabled } from '../src/lib/db.js';
import { config } from '../src/config.js';
import { gateProbability, loadGateModel } from '../src/lib/gate.js';
import { DEFAULT_THRESHOLD } from '../src/routes/common.js';
import { RESULTS_DIR } from './common.js';
import { CONFIGS } from './configs.js';
import {
  aurc, decisionMetrics, gateCurve, mean, riskCoverage, riskCoverageAt,
} from './metrics.js';

const { values: args } = parseArgs({
  options: {
    dataset: { type: 'string' },
    source: { type: 'string' },
    out: { type: 'string' },
    split: { type: 'string', default: 'test' },
    data: { type: 'string' },
    gate: { type: 'string', default: config.gate.file },
    results: { type: 'string' },
  },
});
const source = args.source ?? (args.results || !mongoEnabled() ? 'files' : 'mongo');
const resultsDir = args.results ? path.resolve(args.results) : RESULTS_DIR;

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
  if (source === 'mongo') {
    const col = await collection('evalRuns');
    const runs = await col.find({}, { projection: { _id: 0 } }).sort({ startedAt: 1 }).toArray();
    await closeDb();
    return runs.map((r) => ({ ...r, startedAt: new Date(r.startedAt).toISOString() }));
  }
  const files = (await readdir(resultsDir).catch(() => [])).filter((f) => f.endsWith('.json') && !f.endsWith('.partial.json'));
  const runs = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(resultsDir, f), 'utf8'))));
  // Runs saved before `kind` existed were retrieval runs
  return runs.map((r) => ({ kind: 'retrieval', ...r })).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function retrievalSection(run) {
  const k = run.settings.k;
  const out = [`## Retrieval (${run.dataset}, k=${k}, split: ${run.settings.split ?? 'all'}, ${run.startedAt})`, ''];
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
  const out = [`## Answers (${run.dataset}, k=${run.settings.k}, split: ${run.settings.split ?? 'all'}, judge: ${run.settings.judge ? 'on' : 'off'}, ${run.startedAt})`, ''];
  out.push(table(
    ['Mode', 'Accuracy', 'Answerable answered', 'Unanswerable abstained', 'Citation precision', 'Cited gold page', 'Faithful (supported)', 'p50 ms', 'p95 ms', 'Errors'],
    run.summary.map((s) => [s.mode, pct(s.accuracy), pct(s.answeredRate), pct(s.abstainRate), pct(s.citationPrecision),
      pct(s.citedGoldRate), pct(s.faithfulness?.supported), msf(s.latencyP50), msf(s.latencyP95), s.errors]),
  ));
  const models = run.summary.map((s) => `${s.mode}: ${(s.models ?? []).join(', ') || 'n/a'}`).join('; ');
  const unjudged = run.summary.reduce((n, s) => n + (s.unjudged ?? 0), 0);
  out.push('', 'Accuracy counts abstentions on answerable questions as wrong. Judge: '
    + `${run.rows.find((r) => r.judgeModel)?.judgeModel ?? 'n/a'} (an LLM grading its own family; verify a sample by hand).`,
  `Answer models: ${models}.${unjudged ? ` ${unjudged} answered rows were not judged.` : ''}`);
  return out.join('\n');
}

// The rows of one half. Runs made before rows recorded their half can't be separated.
function inSplit(rows, split) {
  const ok = rows.filter((r) => !r.error);
  if (split === 'all') return { rows: ok, note: 'all questions of the run' };
  if (!ok.some((r) => r.split)) return { rows: ok, note: `the run did not record the split, so ALL its questions are used (tuning questions included)` };
  return { rows: ok.filter((r) => r.split === split), note: `${split} split` };
}

const DECISION_HEADERS = ['Questions', 'Answer rate', 'Unanswerable rejected', 'False abstention'];
const decisionCells = (d) => [d.n, pct(d.answerRate), pct(d.unanswerableRejection), pct(d.falseAbstention)];

// Retrieval runs stop before the answer, so "answered" is the confidence decision and
// correctness is a proxy: the gold page is among the hits of the attempt that was used.
function retrievalDecisions(run, data) {
  const { rows, note } = inSplit(run.rows, args.split);
  const labels = [...new Set(rows.filter((r) => CONFIGS[r.base ?? r.config]?.anchor).map((r) => r.config))];
  if (!labels.length) return null;
  const lines = labels.map((label) => {
    const mine = rows.filter((r) => r.config === label);
    const d = decisionMetrics(mine.map((r) => {
      const gold = r.attempts?.[r.bestAttempt ?? 0]?.goldRetrieved ?? (r.recall ?? 0) > 0;
      return { answerable: r.answerable, answered: Boolean(r.confident), correct: r.confident ? Boolean(r.answerable && gold) : null };
    }));
    const isGate = CONFIGS[mine[0].base ?? label]?.gate;
    const gateUsed = isGate ? mean(mine.map((r) => (r.gate?.used ? 1 : 0))) : null;
    data.push({ config: label, ...d, gateUsed });
    return [label, ...decisionCells(d).slice(0, 2), pct(d.accuracyOnAnswered), ...decisionCells(d).slice(2), isGate ? pct(gateUsed) : '–'];
  });
  return [
    `## Answer or abstain, retrieval level (${run.dataset}, ${note})`, '',
    table(['Config', DECISION_HEADERS[0], DECISION_HEADERS[1], 'Gold page retrieved when answered', ...DECISION_HEADERS.slice(2), 'Gate decided'], lines), '',
    'No answer is generated in a retrieval run: "answered" means the confidence check passed, and the third column is a proxy for accuracy.',
    '"Gate decided" below 100% means the coefficients file was missing for those questions and the threshold decided instead.',
  ].join('\n');
}

function answerDecisions(run, data) {
  const { rows, note } = inSplit(run.rows, args.split);
  const modes = [...new Set(rows.map((r) => r.mode))];
  if (!modes.length) return null;
  const lines = modes.map((mode) => {
    const mine = rows.filter((r) => r.mode === mode);
    const d = decisionMetrics(mine.map((r) => {
      let correct = null;
      if (!r.abstained) correct = r.answerable ? (r.correctness ? r.correctness === 'correct' : null) : false;
      return { answerable: r.answerable, answered: !r.abstained, correct };
    }));
    const isGate = mine.some((r) => r.gate);
    const gateUsed = isGate ? mean(mine.map((r) => (r.gate?.used ? 1 : 0))) : null;
    data.push({ mode, ...d, gateUsed });
    return [mode, ...decisionCells(d).slice(0, 2), pct(d.accuracyOnAnswered), ...decisionCells(d).slice(2), d.ungraded, isGate ? pct(gateUsed) : '–'];
  });
  return [
    `## Answer or abstain, answer level (${run.dataset}, ${note})`, '',
    table(['Mode', DECISION_HEADERS[0], DECISION_HEADERS[1], 'Accuracy on answered', ...DECISION_HEADERS.slice(2), 'Ungraded answers', 'Gate decided'], lines), '',
    'Accuracy on answered: answers the judge marks correct, out of the graded answers; an answer to an unanswerable question is wrong.',
    'False abstention: answerable questions that got no answer, whichever check refused.',
  ].join('\n');
}

// Per-question evidence for the curves: the confidence signals of the attempt that was
// judged, whether an answer would come out at all (passes), and whether it would be right.
function curveSources(retrieval, answers) {
  const sources = [];
  if (answers) {
    const { rows, note } = inSplit(answers.rows.filter((r) => r.mode === 'anchor-soft'), args.split);
    const usable = rows
      .map((r) => ({ r, signals: r.attempts?.[r.bestAttempt ?? 0]?.signals }))
      .filter(({ r, signals }) => signals && (r.abstained || !r.answerable || r.correctness));
    if (rows.length) {
      sources.push({
        title: 'answer level',
        detail: `anchor-soft answers, ${note}; ${usable.length} of ${rows.length} questions usable (the rest have no rerank signals or an ungraded answer). `
          + 'Wrong = an answer the judge does not mark correct, or any answer to an unanswerable question.',
        rows: usable.map(({ r, signals }) => ({ signals, passes: !r.abstained, correct: Boolean(r.answerable && r.correctness === 'correct') })),
      });
    }
  }
  if (retrieval) {
    const noRetry = retrieval.rows.filter((r) => (r.base ?? r.config) === 'anchor-noretry');
    const { rows, note } = inSplit(noRetry.filter((r) => r.config === noRetry[0]?.config), args.split);
    const usable = rows.filter((r) => r.attempts?.[0]?.signals);
    if (rows.length) {
      sources.push({
        title: 'retrieval level (proxy)',
        detail: `anchor-noretry first attempts, ${note}; ${usable.length} of ${rows.length} questions have signals. `
          + 'No answer is generated: wrong = the gold page is not among the hits, or the question is unanswerable.',
        rows: usable.map((r) => ({ signals: r.attempts[0].signals, passes: true, correct: Boolean(r.answerable && r.attempts[0].goldRetrieved) })),
      });
    }
  }
  return sources;
}

function coverageRisk(retrieval, answers, dataset, data) {
  const sources = curveSources(retrieval, answers);
  if (!sources.length) return null;
  const model = loadGateModel(args.gate);
  const out = ['## Coverage and risk: fixed threshold vs evidence gate', '',
    'Each method ranks the questions by its own confidence and answers those at or above a cut-off. '
    + 'Coverage = questions answered / all questions; risk = wrong answers / answers.'];
  if (model) {
    const fit = model.fit ?? {};
    out.push(`Gate coefficients: ${path.basename(args.gate)}, fitted on the ${fit.split ?? '?'} split of "${fit.dataset ?? '?'}" `
      + `(${fit.examples ?? '?'} attempts, ${fit.createdAt ?? 'date unknown'}).`
      + (fit.dataset && fit.dataset !== dataset ? ` WARNING: that is not this dataset (${dataset}).` : '')
      + (args.split !== 'test' ? ` WARNING: split "${args.split}" includes questions the gate may have been fitted on.` : ''));
  } else {
    out.push(`No usable coefficients file at ${args.gate}, so only the threshold is shown. Fit one with eval/fit-gate.js.`);
  }

  for (const src of sources) {
    const methods = [{
      name: 'Threshold (top rerank score)',
      rows: src.rows.map((r) => ({ ...r, score: r.signals.topScore })),
      marks: [[0.3, '0.3'], [DEFAULT_THRESHOLD, `${DEFAULT_THRESHOLD} (server default)`]],
    }];
    if (model) {
      methods.push({
        name: 'Evidence gate (probability)',
        rows: src.rows.map((r) => ({ ...r, score: gateProbability(model, r.signals) })),
        marks: [[config.gate.high, `${config.gate.high} (high cut-off)`], [config.gate.low, `${config.gate.low} (low cut-off)`]],
      });
    }
    const computed = methods.map((m) => ({
      name: m.name,
      aurc: aurc(m.rows),
      operatingPoints: m.marks.map(([cutoff, label]) => ({ label, ...riskCoverageAt(m.rows, cutoff) })),
      curve: riskCoverage(m.rows),
    }));
    data.push({ source: src.title, questions: src.rows.length, methods: computed });

    out.push('', `### ${src.title} (n=${src.rows.length})`, '', src.detail, '');
    if (!src.rows.length) continue;
    out.push(table(['Method', 'Cut-off', 'Answered', 'Coverage', 'Risk'],
      computed.flatMap((m) => m.operatingPoints.map((p) => [m.name, p.label, p.answered, pct(p.coverage), pct(p.risk)]))));
    out.push('', `Area under the coverage-risk curve (lower is better): ${computed.map((m) => `${m.name} ${dec(m.aurc)}`).join('; ')}.`);
    out.push('', 'Curve data (one row per distinct score, strictest cut-off first):', '');
    out.push(table(['Method', 'Cut-off', 'Answered', 'Coverage', 'Risk'],
      computed.flatMap((m) => m.curve.map((p) => [m.name, dec(p.cutoff), p.answered, dec(p.coverage), dec(p.risk)]))));
  }
  return out.join('\n');
}

function alphaSection(run) {
  const k = run.settings.k;
  return [
    `## Convex fusion: alpha search (${run.dataset}, tuning split, ${run.settings.questions} answerable questions, k=${k}, ${run.startedAt})`, '',
    table(['Alpha (vector weight)', `Recall@${k}`, 'MRR'], [
      ...run.grid.map((g) => [g.alpha === run.best.alpha ? `**${g.alpha}**` : g.alpha, dec(g.recall), dec(g.mrr)]),
      ['RRF 0.5/0.5 (reference)', dec(run.rrf.recall), dec(run.rrf.mrr)],
    ]), '',
    `Best alpha on the tuning split: ${run.best.alpha}. These are tuning numbers; the test-split result is the hybrid-convex row of a retrieval run made with --alpha ${run.best.alpha} --split test.`,
  ].join('\n');
}

async function main() {
  const runs = await loadRuns();
  if (!runs.length) throw new Error(`No eval runs found (source: ${source})`);
  const dataset = args.dataset ?? runs.at(-1).dataset;
  const latest = (kind) => runs.filter((r) => r.dataset === dataset && r.kind === kind).at(-1);

  const sections = [`# Anchor evaluation: ${dataset}`];
  const retrieval = latest('retrieval');
  const answers = latest('answers');
  const alpha = latest('alpha');
  if (!retrieval && !answers && !alpha) throw new Error(`No runs for dataset ${dataset}`);
  const data = { dataset, split: args.split, decisions: { retrieval: [], answers: [] }, coverageRisk: [], alpha: alpha ?? null };

  if (retrieval) sections.push(retrievalSection(retrieval));
  if (answers) sections.push(answersSection(answers));
  if (retrieval) sections.push(retrievalDecisions(retrieval, data.decisions.retrieval));
  if (answers) sections.push(answerDecisions(answers, data.decisions.answers));
  sections.push(coverageRisk(retrieval, answers, dataset, data.coverageRisk));
  if (alpha) sections.push(alphaSection(alpha));

  const md = `${sections.filter(Boolean).join('\n\n')}\n`;
  if (args.data) {
    await writeFile(args.data, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Wrote ${args.data}`);
  }
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
