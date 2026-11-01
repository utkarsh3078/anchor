// Retrieval evaluation runner. The server must be running.
//   node eval/run.js eval/datasets/smoke.json [--configs dense,hybrid,anchor] [--k 5]
//     [--threshold 0.3 | --threshold 0.1,0.2,0.3] [--rerank-delay 6500] [--upload]
//     [--model M] [--rewrite-model M] [--resume eval/results/<run>.partial.json]
//     [--base http://localhost:4000]
// Several thresholds run each anchor config once per threshold (labelled anchor@0.2 etc).
// Only anchor configs with retries call Gemini for text (query rewrites); the rest only
// embed the query. A run stopped by a quota continues with --resume, e.g. on another model.
import { parseArgs } from 'util';
import { CONFIGS, DEFAULT_CONFIGS } from './configs.js';
import { anyRelevant, recallAtK, reciprocalRank, mean, percentile } from './metrics.js';
import {
  makeApi, geminiHeaders, loadDataset, resolveDocs, openCheckpoint, sleep, round, errorGuard,
} from './common.js';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    configs: { type: 'string', default: DEFAULT_CONFIGS.join(',') },
    k: { type: 'string', default: '5' },
    threshold: { type: 'string' },
    // Cohere trial keys allow 10 calls/min; set 0 with a production key
    'rerank-delay': { type: 'string', default: '6500' },
    upload: { type: 'boolean', default: false },
    model: { type: 'string' },
    'rewrite-model': { type: 'string' },
    resume: { type: 'string' },
    base: { type: 'string', default: process.env.ANCHOR_URL || 'http://localhost:4000' },
  },
});

function scoreRow(run, q, res, k) {
  const row = {
    config: run.label, base: run.config, id: q.id, category: q.category ?? null,
    answerable: q.answerable, latencyMs: res.latencyMs,
  };
  if (q.answerable) {
    row.recall = recallAtK(res.hits, q.gold, k);
    row.rr = reciprocalRank(res.hits, q.gold);
  }
  if (CONFIGS[run.config].anchor) {
    row.topScore = round(res.confidence.topScore);
    row.firstTopScore = round(res.attempts[0].topScore);
    row.confident = res.confidence.confident;
    row.retries = res.retries;
    if (q.answerable && res.retries > 0) {
      // A retry "helped" if the first attempt missed the gold page and the final result has it
      row.retryHelped = !anyRelevant(res.attempts[0].hits, q.gold) && anyRelevant(res.hits, q.gold);
    }
  }
  return row;
}

function summarise(run, rows) {
  const ok = rows.filter((r) => !r.error);
  const ans = ok.filter((r) => r.answerable);
  const unans = ok.filter((r) => !r.answerable);
  const lat = ok.map((r) => r.latencyMs);
  const s = {
    config: run.label,
    n: rows.length,
    errors: rows.length - ok.length,
    recall: round(mean(ans.map((r) => r.recall))),
    mrr: round(mean(ans.map((r) => r.rr))),
    latencyMean: Math.round(mean(lat) ?? 0),
    latencyP50: percentile(lat, 50),
    latencyP95: percentile(lat, 95),
  };
  if (CONFIGS[run.config].anchor) {
    const retried = ans.filter((r) => r.retries > 0);
    Object.assign(s, {
      answeredRate: round(mean(ans.map((r) => (r.confident ? 1 : 0)))), // answerable kept, higher is better
      abstainRate: round(mean(unans.map((r) => (r.confident ? 0 : 1)))), // unanswerable caught, higher is better
      retryRate: round(mean(ok.map((r) => (r.retries > 0 ? 1 : 0)))),
      retryPrecision: retried.length ? round(mean(retried.map((r) => (r.retryHelped ? 1 : 0)))) : null,
    });
  }
  return s;
}

// One run per config, or one per (anchor config, threshold) for a sweep
function planRuns(configs, thresholds) {
  return configs.flatMap((config) => {
    const anchor = CONFIGS[config].anchor;
    if (!anchor || thresholds.length <= 1) {
      return [{ label: config, config, extra: anchor && thresholds.length ? { threshold: thresholds[0] } : {} }];
    }
    return thresholds.map((t) => ({ label: `${config}@${t}`, config, extra: { threshold: t } }));
  });
}

async function main() {
  if (!positionals[0]) throw new Error('usage: node eval/run.js <dataset.json> [options]');
  const { dataset, datasetDir } = await loadDataset(positionals[0]);
  const api = makeApi(args.base, geminiHeaders({ model: args.model, rewriteModel: args['rewrite-model'] }));
  const configs = args.configs.split(',').map((c) => c.trim());
  const unknown = configs.filter((c) => !CONFIGS[c]);
  if (unknown.length) throw new Error(`unknown configs: ${unknown.join(', ')} (known: ${Object.keys(CONFIGS).join(', ')})`);
  const thresholds = args.threshold ? args.threshold.split(',').map(Number) : [];

  const checkpoint = await openCheckpoint({
    kind: 'retrieval',
    dataset: dataset.name,
    settings: { k: Number(args.k), configs, thresholds, rerankDelay: Number(args['rerank-delay']) },
    resume: args.resume,
  });
  const { k, rerankDelay } = checkpoint.settings;
  const runs = planRuns(checkpoint.settings.configs, checkpoint.settings.thresholds);

  const docIds = await resolveDocs(api, dataset, datasetDir, { upload: args.upload });
  console.log(`${dataset.name}: ${dataset.questions.length} questions x ${runs.length} runs, k=${k}`);

  const guard = errorGuard();
  try {
    for (const run of runs) {
      const { path: route, body, rerankCalls } = CONFIGS[run.config];
      for (const q of dataset.questions) {
        if (checkpoint.isDone(run.label, q.id)) continue;
        try {
          const res = await api('POST', route, { query: q.question, k, docIds, ...body, ...run.extra });
          await checkpoint.add(scoreRow(run, q, res, k));
          guard.ok();
          if (rerankDelay) await sleep(rerankDelay * rerankCalls(res));
        } catch (e) {
          await checkpoint.add({ config: run.label, base: run.config, id: q.id, answerable: q.answerable, error: e.message });
          console.error(`  ${run.label} ${q.id}: ${e.message}`);
          guard.fail(e);
        }
        process.stdout.write('.');
      }
      process.stdout.write(` ${run.label} done\n`);
    }
  } catch (e) {
    throw new Error(`${e.message}\nProgress saved. Continue with: --resume ${checkpoint.file}`);
  }

  const summary = runs.map((run) => summarise(run, checkpoint.rows.filter((r) => r.config === run.label)));
  console.table(summary);
  await checkpoint.finish(summary);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
