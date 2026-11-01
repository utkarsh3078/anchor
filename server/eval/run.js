// Retrieval evaluation runner. The server must be running.
//   node eval/run.js eval/datasets/smoke.json [--configs dense,hybrid,anchor] [--k 5]
//     [--threshold 0.3] [--rerank-delay 6500] [--upload] [--base http://localhost:4000]
// Writes eval/results/<dataset>-<timestamp>.json and prints a summary table.
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { CONFIGS, DEFAULT_CONFIGS } from './configs.js';
import { anyRelevant, recallAtK, reciprocalRank, mean, percentile } from './metrics.js';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    configs: { type: 'string', default: DEFAULT_CONFIGS.join(',') },
    k: { type: 'string', default: '5' },
    threshold: { type: 'string' },
    // Cohere trial keys allow 10 calls/min; set 0 with a production key
    'rerank-delay': { type: 'string', default: '6500' },
    upload: { type: 'boolean', default: false },
    base: { type: 'string', default: process.env.ANCHOR_URL || 'http://localhost:4000' },
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

async function api(method, route, body) {
  const res = await fetch(args.base + route, {
    method,
    headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    body: body instanceof FormData ? body : body && JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${json.error ?? JSON.stringify(json)}`);
  return json;
}

// Map each dataset document to exactly one indexed docId, so other documents in the
// index can't compete and duplicate uploads can't inflate results.
async function resolveDocs(dataset, datasetDir) {
  let indexed = await api('GET', '/api/documents');
  const docIds = [];
  for (const doc of dataset.docs) {
    let matches = indexed.filter((d) => d.docName === doc.name);
    if (!matches.length && args.upload && doc.file) {
      const file = await readFile(path.resolve(datasetDir, doc.file));
      const form = new FormData();
      form.append('file', new Blob([file], { type: doc.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain' }), doc.name);
      console.log(`Uploading ${doc.name}...`);
      await api('POST', '/api/documents', form);
      indexed = await api('GET', '/api/documents');
      matches = indexed.filter((d) => d.docName === doc.name);
    }
    if (!matches.length) throw new Error(`${doc.name} is not indexed (rerun with --upload)`);
    if (matches.length > 1) {
      throw new Error(`${doc.name} is indexed ${matches.length} times; delete duplicates: ${matches.map((d) => d.docId).join(', ')}`);
    }
    docIds.push(matches[0].docId);
  }
  return docIds;
}

function scoreRow(config, q, res, k) {
  const row = { config, id: q.id, category: q.category ?? null, answerable: q.answerable, latencyMs: res.latencyMs };
  if (q.answerable) {
    row.recall = recallAtK(res.hits, q.gold, k);
    row.rr = reciprocalRank(res.hits, q.gold);
  }
  if (CONFIGS[config].anchor) {
    row.topScore = round(res.confidence.topScore);
    row.confident = res.confidence.confident;
    row.retries = res.retries;
    if (q.answerable && res.retries > 0) {
      // A retry "helped" if the first attempt missed the gold page and the final result has it
      row.retryHelped = !anyRelevant(res.attempts[0].hits, q.gold) && anyRelevant(res.hits, q.gold);
    }
  }
  return row;
}

function summarise(config, rows) {
  const ok = rows.filter((r) => !r.error);
  const ans = ok.filter((r) => r.answerable);
  const unans = ok.filter((r) => !r.answerable);
  const lat = ok.map((r) => r.latencyMs);
  const s = {
    config,
    n: rows.length,
    errors: rows.length - ok.length,
    recall: round(mean(ans.map((r) => r.recall))),
    mrr: round(mean(ans.map((r) => r.rr))),
    latencyMean: Math.round(mean(lat) ?? 0),
    latencyP50: percentile(lat, 50),
    latencyP95: percentile(lat, 95),
  };
  if (CONFIGS[config].anchor) {
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

async function main() {
  if (!positionals[0]) throw new Error('usage: node eval/run.js <dataset.json> [options]');
  const datasetPath = path.resolve(positionals[0]);
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
  const k = Number(args.k);
  const configs = args.configs.split(',').map((c) => c.trim());
  const unknown = configs.filter((c) => !CONFIGS[c]);
  if (unknown.length) throw new Error(`unknown configs: ${unknown.join(', ')} (known: ${Object.keys(CONFIGS).join(', ')})`);
  const rerankDelay = Number(args['rerank-delay']);

  const docIds = await resolveDocs(dataset, path.dirname(datasetPath));
  const startedAt = new Date().toISOString();
  console.log(`${dataset.name}: ${dataset.questions.length} questions x ${configs.length} configs, k=${k}`);

  const rows = [];
  for (const config of configs) {
    const { path: route, body, rerankCalls } = CONFIGS[config];
    const extra = CONFIGS[config].anchor && args.threshold ? { threshold: Number(args.threshold) } : {};
    for (const q of dataset.questions) {
      try {
        const res = await api('POST', route, { query: q.question, k, docIds, ...body, ...extra });
        rows.push(scoreRow(config, q, res, k));
        if (rerankDelay) await sleep(rerankDelay * rerankCalls(res));
      } catch (e) {
        rows.push({ config, id: q.id, answerable: q.answerable, error: e.message });
        console.error(`  ${config} ${q.id}: ${e.message}`);
      }
      process.stdout.write('.');
    }
    process.stdout.write(` ${config} done\n`);
  }

  const summary = configs.map((c) => summarise(c, rows.filter((r) => r.config === c)));
  const settings = { k, configs, threshold: args.threshold ? Number(args.threshold) : 'server default', rerankDelay };

  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `${dataset.name}-${startedAt.replace(/[:.]/g, '-')}.json`);
  await writeFile(outFile, JSON.stringify({ dataset: dataset.name, startedAt, settings, summary, rows }, null, 2));

  console.table(summary);
  console.log(`Saved ${path.relative(process.cwd(), outFile)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
