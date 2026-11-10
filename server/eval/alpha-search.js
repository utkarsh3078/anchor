// Grid search of the convex-fusion alpha (0 to 1 in steps of 0.1) on the TUNING split.
// The server must be running.
//   node eval/alpha-search.js eval/datasets/real.json [--k 5] [--upload] [--model M] [--base http://localhost:4000]
// Per tuning question it fetches the BM25 and vector candidate lists once (one query
// embedding, no rerank, no generation) and fuses them here for every alpha with the
// server's own fusion code, at the server's default candidate depth (50).
// It prints the best alpha; set FUSION_ALPHA (or pass --alpha to eval/run.js) to use it.
import { parseArgs } from 'util';
import { ALPHAS, alphaGrid, bestAlpha, rrfReference } from './alpha.js';
import { makeApi, geminiHeaders, loadDataset, resolveDocs, saveRun, round } from './common.js';
import { questionsIn } from './split.js';

const CANDIDATES = 50;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    k: { type: 'string', default: '5' },
    upload: { type: 'boolean', default: false },
    model: { type: 'string' },
    base: { type: 'string', default: process.env.ANCHOR_URL || 'http://localhost:4000' },
  },
});

async function main() {
  if (!positionals[0]) throw new Error('usage: node eval/alpha-search.js <dataset.json> [options]');
  const { dataset, datasetDir } = await loadDataset(positionals[0]);
  const api = makeApi(args.base, geminiHeaders({ model: args.model }));
  const k = Number(args.k);
  const questions = questionsIn(dataset, 'tune').filter((q) => q.answerable);
  if (!questions.length) throw new Error('The tuning split has no answerable questions');

  const docIds = await resolveDocs(api, dataset, datasetDir, { upload: args.upload });
  console.log(`${dataset.name}: ${questions.length} answerable tuning questions, k=${k}, candidates=${CANDIDATES}`);

  const startedAt = new Date().toISOString();
  const perQuestion = [];
  for (const q of questions) {
    const body = { query: q.question, k: CANDIDATES, docIds };
    const dense = await api('POST', '/api/search/dense', body);
    const keyword = await api('POST', '/api/search/keyword', { ...body, engine: 'bm25' });
    perQuestion.push({ id: q.id, gold: q.gold, dense: dense.hits, keyword: keyword.hits });
    process.stdout.write('.');
  }
  process.stdout.write('\n');

  const grid = alphaGrid(perQuestion, { k, alphas: ALPHAS }).map((g) => ({ alpha: g.alpha, recall: round(g.recall), mrr: round(g.mrr) }));
  const rrf = rrfReference(perQuestion, { k });
  const best = bestAlpha(grid);
  console.table(grid);
  console.log(`RRF 0.5/0.5 on the same lists: recall ${round(rrf.recall)}, MRR ${round(rrf.mrr)}`);
  console.log(`Best alpha on the tuning split: ${best.alpha} (recall@${k} ${best.recall}, MRR ${best.mrr}).`
    + ' Tuning numbers, not results: measure on the test split.');
  console.log(`Use it with FUSION_ALPHA=${best.alpha} in server/.env, or --alpha ${best.alpha} in eval/run.js.`);

  await saveRun({
    kind: 'alpha', dataset: dataset.name, startedAt,
    settings: { k, candidates: CANDIDATES, split: 'tune', questions: questions.length },
    grid, rrf: { recall: round(rrf.recall), mrr: round(rrf.mrr) }, best,
    rows: [],
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
