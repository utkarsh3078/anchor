import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { collection, mongoEnabled } from './db.js';
import { loadFeedbackTotals } from './feedback.js';
import { config } from '../config.js';

// The public results page (GET /api/results): the latest evaluation runs of one dataset,
// reduced to totals. Questions, answers, passages and document text never leave the
// server; only counts, rates and latencies do. Everything is recomputed from the run's
// rows, so a run that was graded after it finished (eval/sync.js) shows its grades.

const EVAL_DIR = fileURLToPath(new URL('../../eval/', import.meta.url));

// Retrieval configurations in the order the page builds them up, with plain names
const CONFIG_LABELS = {
  dense: 'Meaning search',
  bm25: 'Keyword search',
  hybrid: 'Both combined',
  'hybrid+rerank': '+ Re-ranking',
  'anchor-noretry': '+ Routing and confidence check',
  anchor: 'Full Anchor (+ retry)',
};
const MODE_LABELS = { 'anchor-soft': 'Anchor', anchor: 'Anchor (strict)', hybrid: 'Plain hybrid search', dense: 'Meaning search only' };
const THRESHOLDS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
function percentile(xs, p) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}
const docLabel = (name) => name.replace(/\.(pdf|txt|md)$/i, '').replace(/[_-]+/g, ' ').trim();

// question id -> its document's display name, from the dataset file (rows only carry the
// id). A dataset document may set `label`; otherwise the file name is tidied up.
export function documentsOf(dataset) {
  if (!dataset) return null;
  const label = new Map((dataset.docs ?? []).map((d) => [d.name, d.label ?? docLabel(d.name)]));
  const nameOf = (doc) => label.get(doc) ?? docLabel(doc);
  const byId = new Map(dataset.questions.filter((q) => q.gold?.length).map((q) => [q.id, nameOf(q.gold[0].doc)]));
  return { byId, names: [...label.values()] };
}

function retrievalPart(run, docs) {
  const ok = run.rows.filter((r) => !r.error);
  const configs = run.settings.configs.filter((c) => ok.some((r) => r.config === c));
  const answerable = (c) => ok.filter((r) => r.config === c && r.answerable);
  const categories = [...new Set(ok.filter((r) => r.answerable).map((r) => r.category ?? 'other'))];

  const noRetry = ok.filter((r) => r.config === 'anchor-noretry');
  const threshold = noRetry.length
    ? THRESHOLDS.map((t) => ({
      threshold: t,
      answerableKept: round(mean(noRetry.filter((r) => r.answerable).map((r) => ((r.firstTopScore ?? r.topScore) >= t ? 1 : 0)))),
      unanswerableCaught: round(mean(noRetry.filter((r) => !r.answerable).map((r) => ((r.firstTopScore ?? r.topScore) < t ? 1 : 0)))),
    }))
    : [];
  const full = ok.filter((r) => r.config === 'anchor');

  return {
    measuredAt: run.startedAt,
    k: run.settings.k,
    questions: new Set(ok.map((r) => r.id)).size,
    configs: configs.map((c) => {
      const rows = ok.filter((r) => r.config === c);
      const lat = rows.map((r) => r.latencyMs);
      return {
        config: c,
        label: CONFIG_LABELS[c] ?? c,
        recall: round(mean(answerable(c).map((r) => r.recall))),
        mrr: round(mean(answerable(c).map((r) => r.rr))),
        found: answerable(c).filter((r) => r.recall > 0).length, // at least one right page in the top k
        answerable: answerable(c).length,
        latencyP50: percentile(lat, 50),
        latencyP95: percentile(lat, 95),
      };
    }),
    byCategory: categories.map((cat) => ({
      category: cat,
      questions: answerable(configs[0]).filter((r) => (r.category ?? 'other') === cat).length,
      recall: Object.fromEntries(configs.map((c) => [c, round(mean(answerable(c).filter((r) => (r.category ?? 'other') === cat).map((r) => r.recall)))])),
    })),
    byDocument: docs
      ? docs.names.map((name) => ({
        document: name,
        questions: answerable(configs[0]).filter((r) => docs.byId.get(r.id) === name).length,
        recall: Object.fromEntries(configs.map((c) => [c, round(mean(answerable(c).filter((r) => docs.byId.get(r.id) === name).map((r) => r.recall)))])),
      })).filter((d) => d.questions)
      : [],
    threshold,
    defaultThreshold: 0.15,
    retries: full.length
      ? { questions: full.filter((r) => r.retries > 0).length, helped: full.filter((r) => r.retries > 0 && (r.attempts?.[r.bestAttempt ?? 0]?.goldRetrieved && !r.attempts?.[0]?.goldRetrieved)).length }
      : null,
  };
}

function answersPart(run) {
  const ok = run.rows.filter((r) => !r.error);
  const modes = run.settings.modes.filter((m) => ok.some((r) => r.mode === m));
  const graded = ok.some((r) => r.correctness);
  return {
    measuredAt: run.startedAt,
    k: run.settings.k,
    questions: new Set(ok.map((r) => r.id)).size,
    models: [...new Set(ok.map((r) => r.model).filter(Boolean))],
    gradedBy: graded ? (run.grading?.by ?? ok.find((r) => r.judgeModel)?.judgeModel ?? 'unknown') : null,
    modes: modes.map((mode) => {
      const rows = ok.filter((r) => r.mode === mode);
      const ans = rows.filter((r) => r.answerable);
      const unans = rows.filter((r) => !r.answerable);
      const answered = ans.filter((r) => !r.abstained);
      const correct = ans.filter((r) => r.correctness === 'correct').length;
      const lat = rows.map((r) => r.latencyMs);
      return {
        mode,
        label: MODE_LABELS[mode] ?? mode,
        answerable: ans.length,
        answered: answered.length,
        correct: graded ? correct : null,
        accuracy: graded ? round(correct / ans.length) : null,
        accuracyOnAnswered: graded && answered.length ? round(correct / answered.length) : null,
        unanswerable: unans.length,
        refused: unans.filter((r) => r.abstained).length,
        citedRightPage: answered.length ? round(mean(answered.map((r) => (r.citedGold ? 1 : 0)))) : null,
        citationPrecision: round(mean(answered.map((r) => r.citationPrecision).filter((x) => x != null))),
        latencyP50: percentile(lat, 50),
        latencyP95: percentile(lat, 95),
      };
    }),
  };
}

// runs: { retrieval, answers } (either may be missing); dataset: the dataset file, optional;
// feedback: visitor rating totals (lib/feedback.js), shown apart from the measured numbers
export function publicResults({ retrieval, answers, dataset, feedback = null }) {
  const docs = documentsOf(dataset);
  const qs = dataset?.questions ?? [];
  return {
    dataset: {
      name: retrieval?.dataset ?? answers?.dataset,
      questions: qs.length || null,
      answerable: qs.filter((q) => q.answerable).length || null,
      unanswerable: qs.filter((q) => !q.answerable).length || null,
      documents: docs?.names ?? [],
    },
    retrieval: retrieval ? retrievalPart(retrieval, docs) : null,
    answers: answers ? answersPart(answers) : null,
    feedback,
  };
}

// Latest run of each kind for a dataset: MongoDB evalRuns when configured, else the run
// files in server/eval/results. Ties on startedAt (a run re-saved after a resume or a
// sync) go to the most recently stored one.
async function latestFromMongo(dataset, kind) {
  const col = await collection('evalRuns');
  const [run] = await col.find({ dataset, kind }).sort({ startedAt: -1, _id: -1 }).limit(1).toArray();
  return run ? { ...run, startedAt: new Date(run.startedAt).toISOString() } : null;
}

async function latestFromFiles(dataset, kind, dir) {
  const prefix = `${dataset}-${kind}-`;
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.startsWith(prefix) && f.endsWith('.json') && !f.endsWith('.partial.json')).sort();
  if (!files.length) return null;
  return JSON.parse(await readFile(path.join(dir, files.at(-1)), 'utf8'));
}

export async function loadResults(dataset, { dir = path.join(EVAL_DIR, 'results'), datasetsDir = path.join(EVAL_DIR, 'datasets') } = {}) {
  let latest = (kind) => latestFromFiles(dataset, kind, dir);
  if (mongoEnabled()) {
    latest = async (kind) => {
      try {
        return (await latestFromMongo(dataset, kind)) ?? (await latestFromFiles(dataset, kind, dir));
      } catch {
        return latestFromFiles(dataset, kind, dir); // MongoDB unreachable: the files still answer
      }
    };
  }
  const [retrieval, answers] = await Promise.all([latest('retrieval'), latest('answers')]);
  if (!retrieval && !answers) return null;
  const datasetFile = await readFile(path.join(datasetsDir, `${dataset}.json`), 'utf8').then(JSON.parse, () => null);
  // Ratings from every visitor of this server, whatever documents they asked about
  let feedback = null;
  if (mongoEnabled()) {
    try {
      const col = await collection('messages');
      if (col) feedback = await loadFeedbackTotals(col);
    } catch {
      feedback = null; // MongoDB unreachable: the page shows the measured numbers without ratings
    }
  }
  return publicResults({ retrieval, answers, dataset: datasetFile, feedback });
}

export const resultsDataset = () => config.results.dataset;
