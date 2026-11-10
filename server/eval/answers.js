// Answer-level evaluation through /api/ask. The server must be running.
//   node eval/answers.js eval/datasets/smoke.json [--modes dense,hybrid,anchor] [--k 5]
//     [--threshold 0.3] [--no-judge] [--rerank-delay 6500] [--upload] [--base ...]
//     [--model M] [--rewrite-model M] [--judge-model M] [--resume <run>.partial.json]
// Answerable questions: was it answered, is it correct, do citations point at gold pages.
// Unanswerable questions: did it abstain. Answered rows are graded for faithfulness
// (answer vs its cited passages) and correctness (vs the reference) by judge.js.
// Gemini requests per question: 1 answer (none if retrieval abstains) + up to 1 rewrite
// per retry + 1 judge. Free tier: spread a run over days with --resume, and switch
// --model / --judge-model when one model's quota runs out (each row records its model).
import { parseArgs } from 'util';
import { makeJudge } from './judge.js';
import { geminiHttpError } from '../src/lib/gemini.js';
import { attemptLog } from '../src/lib/signals.js';
import { citationPrecision, anyRelevant, mean, percentile, shares } from './metrics.js';
import {
  makeApi, geminiHeaders, loadDataset, resolveDocs, openCheckpoint, sleep, round, errorGuard,
} from './common.js';

// Anchor runs strict (hard confidence gate) so abstention is measured as designed;
// anchor-soft is the UI default (answers below the threshold, flagged lowConfidence)
const MODES = {
  dense: { mode: 'dense' },
  hybrid: { mode: 'hybrid' },
  'anchor-noretry': { mode: 'anchor', maxRetries: 0, strict: true },
  anchor: { mode: 'anchor', strict: true },
  'anchor-soft': { mode: 'anchor' },
};

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    modes: { type: 'string', default: 'dense,hybrid,anchor' },
    k: { type: 'string', default: '5' },
    threshold: { type: 'string' },
    'no-judge': { type: 'boolean', default: false },
    'rerank-delay': { type: 'string', default: '6500' },
    upload: { type: 'boolean', default: false },
    model: { type: 'string' },
    'rewrite-model': { type: 'string' },
    'judge-model': { type: 'string' },
    resume: { type: 'string' },
    base: { type: 'string', default: process.env.ANCHOR_URL || 'http://localhost:4000' },
  },
});

const judgeAnswer = args['no-judge'] ? null : makeJudge(args['judge-model']);

function scoreRow(mode, q, res) {
  const row = {
    mode, id: q.id, category: q.category ?? null, answerable: q.answerable, model: res.model,
    lowConfidence: res.lowConfidence ?? false, overview: res.overview ?? false,
    abstained: res.abstained, abstainReason: res.abstainReason ?? null,
    retries: res.retrieval.retries, latencyMs: res.latencyMs,
    // Per-attempt confidence signals (anchor modes; empty without a rerank)
    bestAttempt: res.retrieval.bestAttempt ?? null, attempts: attemptLog(res.retrieval, q.question),
    answer: res.answer,
    // Passage text is kept so a failed judge call can be redone on --resume without re-asking
    citations: res.citations.map(({ n, docName, page, text }) => ({ n, docName, page, text })),
    invalidCitations: res.invalidCitations ?? 0,
  };
  if (q.answerable && !res.abstained) {
    row.citationPrecision = citationPrecision(row.citations, q.gold);
    row.citedGold = anyRelevant(row.citations, q.gold);
  }
  return row;
}

const needsJudge = (row) => judgeAnswer && !row.error && !row.abstained && !row.faithfulness;

// A judge failure keeps the (already paid for) answer and records judgeError instead
async function judge(row, q) {
  try {
    const verdict = await judgeAnswer({
      question: q.question, reference: q.answerable ? q.answer : null, answer: row.answer, citations: row.citations,
    });
    delete row.judgeError;
    Object.assign(row, verdict);
  } catch (e) {
    row.judgeError = e.message.slice(0, 300);
    const g = geminiHttpError(e); // lets errorGuard recognise a daily quota and stop at once
    if (g) Object.assign(e, { code: g.body.error, scope: g.body.scope, message: `judge: ${g.body.message}` });
    throw e;
  }
}

function summarise(mode, rows) {
  const ok = rows.filter((r) => !r.error);
  const ans = ok.filter((r) => r.answerable);
  const unans = ok.filter((r) => !r.answerable);
  const answered = ok.filter((r) => !r.abstained);
  const ansAnswered = ans.filter((r) => !r.abstained);
  const lat = ok.map((r) => r.latencyMs);
  const judged = answered.filter((r) => r.faithfulness);
  const s = {
    mode,
    n: rows.length,
    errors: rows.length - ok.length,
    answeredRate: round(mean(ans.map((r) => (r.abstained ? 0 : 1)))), // answerable questions answered
    abstainRate: round(mean(unans.map((r) => (r.abstained ? 1 : 0)))), // unanswerable questions abstained
    citationPrecision: round(mean(ansAnswered.map((r) => r.citationPrecision).filter((x) => x != null))),
    citedGoldRate: round(mean(ansAnswered.map((r) => (r.citedGold ? 1 : 0)))),
    latencyP50: percentile(lat, 50),
    latencyP95: percentile(lat, 95),
    abstainReasons: Object.fromEntries(
      ['low_retrieval_confidence', 'not_in_passages', 'no_passages'].map((k) => [k, ok.filter((r) => r.abstainReason === k).length]),
    ),
    models: [...new Set(ok.map((r) => r.model).filter(Boolean))], // more than one = mixed run, say so
    unjudged: answered.filter((r) => !r.faithfulness).length,
  };
  if (judged.length) {
    // Accuracy counts abstentions on answerable questions as not correct
    s.accuracy = round(mean(ans.map((r) => (r.correctness === 'correct' ? 1 : 0))));
    s.faithfulness = Object.fromEntries(
      Object.entries(shares(judged, 'faithfulness', ['supported', 'partial', 'unsupported'])).map(([k, v]) => [k, round(v)]),
    );
  }
  return s;
}

async function main() {
  if (!positionals[0]) throw new Error('usage: node eval/answers.js <dataset.json> [options]');
  const { dataset, datasetDir } = await loadDataset(positionals[0]);
  const api = makeApi(args.base, geminiHeaders({ model: args.model, rewriteModel: args['rewrite-model'] }));
  const modes = args.modes.split(',').map((m) => m.trim());
  const unknown = modes.filter((m) => !MODES[m]);
  if (unknown.length) throw new Error(`unknown modes: ${unknown.join(', ')} (known: ${Object.keys(MODES).join(', ')})`);

  const checkpoint = await openCheckpoint({
    kind: 'answers',
    dataset: dataset.name,
    settings: {
      k: Number(args.k), modes, threshold: args.threshold ? Number(args.threshold) : null,
      judge: !args['no-judge'], rerankDelay: Number(args['rerank-delay']),
    },
    resume: args.resume,
  });
  const { k, threshold, rerankDelay } = checkpoint.settings;
  const thresholdBody = threshold == null ? {} : { threshold };

  const docIds = await resolveDocs(api, dataset, datasetDir, { upload: args.upload });
  console.log(`${dataset.name}: ${dataset.questions.length} questions x ${checkpoint.settings.modes.length} modes, k=${k}`);

  const guard = errorGuard();
  try {
    for (const mode of checkpoint.settings.modes) {
      for (const q of dataset.questions) {
        const done = checkpoint.find(mode, q.id);
        try {
          if (done) {
            if (!needsJudge(done)) continue;
            await judge(done, q); // resume: only the grading is missing
            await checkpoint.save();
          } else {
            const res = await api('POST', '/api/ask', { query: q.question, k, docIds, ...MODES[mode], ...thresholdBody });
            const row = scoreRow(mode, q, res);
            await checkpoint.add(row);
            if (needsJudge(row)) await judge(row, q).finally(() => checkpoint.save());
            const rerankCalls = MODES[mode].mode === 'anchor' ? res.retrieval.attempts.length : 0;
            if (rerankDelay) await sleep(rerankDelay * rerankCalls);
          }
          guard.ok();
        } catch (e) {
          if (!checkpoint.find(mode, q.id)) {
            await checkpoint.add({ mode, id: q.id, answerable: q.answerable, error: e.message });
          }
          console.error(`  ${mode} ${q.id}: ${e.message}`);
          guard.fail(e);
        }
        process.stdout.write('.');
      }
      process.stdout.write(` ${mode} done\n`);
    }
  } catch (e) {
    throw new Error(`${e.message}\nProgress saved. Continue with: --resume ${checkpoint.file}`);
  }

  const modesRun = checkpoint.settings.modes;
  const summary = modesRun.map((m) => summarise(m, checkpoint.rows.filter((r) => r.mode === m)));
  console.table(summary.map(({ abstainReasons, faithfulness, models, ...s }) => ({ ...s, supported: faithfulness?.supported })));
  await checkpoint.finish(summary);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
