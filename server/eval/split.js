// Fixed tuning and test halves of a dataset. Anything that is tuned (the gate's
// coefficients, the fusion alpha, cut-offs) is fitted on `tune`; results are reported on
// `test`. A question's `split` field wins; questions without one are assigned here, the
// same way every time: within each kind of question (answerable or not, and category)
// they are ordered by a hash of their id and dealt to the smaller half.
//   node eval/split.js eval/datasets/real.json           show the halves
//   node eval/split.js eval/datasets/real.json --write   store `split` on every question,
//                                                        so later additions can't move them
import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

export const SPLITS = ['tune', 'test'];

const stratumOf = (q) => `${q.answerable ? 'answerable' : 'unanswerable'}/${q.category ?? 'none'}`;
const hash = (id) => createHash('sha256').update(String(id)).digest('hex');

// questions -> Map(id -> 'tune' | 'test')
export function assignSplits(questions) {
  const splits = new Map();
  const perStratum = new Map();
  const total = { tune: 0, test: 0 };
  const put = (q, split) => {
    splits.set(q.id, split);
    const counts = perStratum.get(stratumOf(q)) ?? { tune: 0, test: 0 };
    counts[split] += 1;
    perStratum.set(stratumOf(q), counts);
    total[split] += 1;
  };

  for (const q of questions) {
    if (q.split === undefined) continue;
    if (!SPLITS.includes(q.split)) throw new Error(`question ${q.id}: split must be "tune" or "test", not ${JSON.stringify(q.split)}`);
    put(q, q.split);
  }
  const rest = questions.filter((q) => q.split === undefined)
    .sort((a, b) => stratumOf(a).localeCompare(stratumOf(b)) || hash(a.id).localeCompare(hash(b.id)));
  for (const q of rest) {
    const c = perStratum.get(stratumOf(q)) ?? { tune: 0, test: 0 };
    // Even stratum: give it to the half that is smaller overall, so odd strata balance out
    const smaller = c.tune === c.test ? (total.tune <= total.test ? 'tune' : 'test') : (c.tune < c.test ? 'tune' : 'test');
    put(q, smaller);
  }
  return splits;
}

// split: 'tune' | 'test' | 'all'
export function questionsIn(dataset, split) {
  if (split === 'all') return dataset.questions;
  if (!SPLITS.includes(split)) throw new Error(`split must be tune, test or all, not ${split}`);
  const splits = assignSplits(dataset.questions);
  return dataset.questions.filter((q) => splits.get(q.id) === split);
}

export function splitCounts(questions) {
  const splits = assignSplits(questions);
  const rows = {};
  for (const q of questions) {
    const row = rows[stratumOf(q)] ??= { tune: 0, test: 0 };
    row[splits.get(q.id)] += 1;
  }
  return rows;
}

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) throw new Error('usage: node eval/split.js <dataset.json> [--write]');
  const datasetPath = path.resolve(file);
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
  console.table(splitCounts(dataset.questions));
  if (flag === '--write') {
    const splits = assignSplits(dataset.questions);
    dataset.questions = dataset.questions.map((q) => ({ ...q, split: splits.get(q.id) }));
    await writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`);
    console.log(`Stored the split on every question in ${file}`);
  } else if (dataset.questions.some((q) => q.split === undefined)) {
    console.log('Not stored. Run again with --write to fix the halves in the dataset file.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
