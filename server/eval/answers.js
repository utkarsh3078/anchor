// Answer-level evaluation through /api/ask. The server must be running.
//   node eval/answers.js eval/datasets/smoke.json [--modes dense,hybrid,anchor] [--k 5]
//     [--threshold 0.3] [--no-judge] [--rerank-delay 6500] [--upload] [--base ...]
// Answerable questions: was it answered, is it correct, do citations point at gold pages.
// Unanswerable questions: did it abstain. Answered rows are graded for faithfulness
// (answer vs its cited passages) and correctness (vs the reference) by judge.js.
import { parseArgs } from 'util';
import { judgeAnswer } from './judge.js';
import { citationPrecision, anyRelevant, mean, percentile, shares } from './metrics.js';
import { makeApi, loadDataset, resolveDocs, saveRun, sleep, round, errorGuard } from './common.js';

const MODES = {
  dense: { mode: 'dense' },
  hybrid: { mode: 'hybrid' },
  'anchor-noretry': { mode: 'anchor', maxRetries: 0 },
  anchor: { mode: 'anchor' },
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
    base: { type: 'string', default: process.env.ANCHOR_URL || 'http://localhost:4000' },
  },
});

async function scoreRow(mode, q, res) {
  const citations = res.citations.map(({ n, docName, page, text }) => ({ n, docName, page, text }));
  const row = {
    mode, id: q.id, category: q.category ?? null, answerable: q.answerable,
    abstained: res.abstained, abstainReason: res.abstainReason ?? null,
    retries: res.retrieval.retries, latencyMs: res.latencyMs,
    answer: res.answer, citations: citations.map(({ n, docName, page }) => ({ n, docName, page })),
    invalidCitations: res.invalidCitations ?? 0,
  };
  if (q.answerable && !res.abstained) {
    row.citationPrecision = citationPrecision(citations, q.gold);
    row.citedGold = anyRelevant(citations, q.gold);
  }
  if (!res.abstained && !args['no-judge']) {
    const verdict = await judgeAnswer({
      question: q.question, reference: q.answerable ? q.answer : null, answer: res.answer, citations,
    });
    Object.assign(row, verdict);
  }
  return row;
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
      ['low_retrieval_confidence', 'not_in_passages'].map((k) => [k, ok.filter((r) => r.abstainReason === k).length]),
    ),
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
  const api = makeApi(args.base);
  const k = Number(args.k);
  const modes = args.modes.split(',').map((m) => m.trim());
  const unknown = modes.filter((m) => !MODES[m]);
  if (unknown.length) throw new Error(`unknown modes: ${unknown.join(', ')} (known: ${Object.keys(MODES).join(', ')})`);
  const threshold = args.threshold ? { threshold: Number(args.threshold) } : {};
  const rerankDelay = Number(args['rerank-delay']);

  const docIds = await resolveDocs(api, dataset, datasetDir, { upload: args.upload });
  const startedAt = new Date().toISOString();
  console.log(`${dataset.name}: ${dataset.questions.length} questions x ${modes.length} modes, k=${k}`);

  const rows = [];
  const guard = errorGuard();
  for (const mode of modes) {
    for (const q of dataset.questions) {
      try {
        const res = await api('POST', '/api/ask', { query: q.question, k, docIds, ...MODES[mode], ...threshold });
        rows.push(await scoreRow(mode, q, res));
        const rerankCalls = MODES[mode].mode === 'anchor' ? res.retrieval.attempts.length : 0;
        guard.ok();
        if (rerankDelay) await sleep(rerankDelay * rerankCalls);
      } catch (e) {
        rows.push({ mode, id: q.id, answerable: q.answerable, error: e.message });
        console.error(`  ${mode} ${q.id}: ${e.message}`);
        guard.fail(e);
      }
      process.stdout.write('.');
    }
    process.stdout.write(` ${mode} done\n`);
  }

  const summary = modes.map((m) => summarise(m, rows.filter((r) => r.mode === m)));
  console.table(summary.map(({ abstainReasons, faithfulness, ...s }) => ({ ...s, supported: faithfulness?.supported })));
  await saveRun({
    kind: 'answers',
    dataset: dataset.name,
    startedAt,
    settings: { k, modes, threshold: threshold.threshold ?? 'server default', judge: !args['no-judge'], rerankDelay },
    summary,
    rows,
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
