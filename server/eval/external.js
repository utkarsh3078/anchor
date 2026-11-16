// Comparison with other systems (ChatGPT, NotebookLM, ...) on the same questions, graded
// by hand. No API calls and no server needed.
//   node eval/external.js sheet <dataset.json> --system chatgpt [--split test|tune|all] [--force]
//       writes eval/external/<dataset>-<system>.csv: one row per question to fill in
//       (answer, abstained, correctness, citation). Rubric: eval/README.md
//   node eval/external.js sheet <dataset.json> --from <answers-run.json> [--mode anchor] [--system anchor]
//       the same sheet pre-filled with Anchor's answers from a saved run, so they can be
//       graded by the same person with the same rubric as the other systems
//   node eval/external.js score <dataset.json> [--systems chatgpt,notebooklm] [--dir <sheets folder>]
//       reads the filled sheets, prints the comparison and saves it as a run
//       (kind "external") that eval/report.js turns into a table
// A system named like a mode of the latest answers run is also compared with the judge's
// verdicts on the same answers: the hand/judge agreement rate.
import { mkdir, readdir, readFile, writeFile, access } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { parseCsv, toCsv } from './csv.js';
import { agreement, externalSummary } from './metrics.js';
import { COLUMNS, CORRECTNESS, readSheet, sameText, sheetRows } from './sheets.js';
import { assignSplits, questionsIn } from './split.js';
import { loadDataset, RESULTS_DIR, round, saveRun } from './common.js';

const exists = (file) => access(file).then(() => true, () => false);

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    system: { type: 'string' },
    systems: { type: 'string' },
    split: { type: 'string', default: 'all' },
    from: { type: 'string' },
    mode: { type: 'string', default: 'anchor' },
    force: { type: 'boolean', default: false },
    dir: { type: 'string' }, // where the sheets live (default eval/external)
  },
});
const SHEETS_DIR = args.dir ? path.resolve(args.dir) : path.join(path.dirname(fileURLToPath(import.meta.url)), 'external');
const sheetFile = (dataset, system) => path.join(SHEETS_DIR, `${dataset}-${system}.csv`);

async function sheet(dataset) {
  const system = args.system ?? (args.from ? args.mode : null);
  if (!system || !/^[\w.+-]+$/.test(system)) throw new Error('give the system a short name: --system chatgpt');
  let answers;
  if (args.from) {
    const run = JSON.parse(await readFile(args.from, 'utf8'));
    if (run.kind !== 'answers' || run.dataset !== dataset.name) throw new Error(`${args.from} is not an answers run of ${dataset.name}`);
    const rows = run.rows.filter((r) => r.mode === args.mode && !r.error);
    if (!rows.length) throw new Error(`${args.from} has no rows for mode ${args.mode}`);
    answers = new Map(rows.map((r) => [r.id, r]));
  }
  // With --from only the questions that run answered go in the sheet
  const questions = questionsIn(dataset, args.split).filter((q) => !answers || answers.has(q.id));
  const file = sheetFile(dataset.name, system);
  if (!args.force && await exists(file)) throw new Error(`${file} exists (it may hold grades). Use --force to replace it`);
  await mkdir(SHEETS_DIR, { recursive: true });
  await writeFile(file, toCsv(COLUMNS, sheetRows(questions, assignSplits(dataset.questions), answers)));
  console.log(`Wrote ${path.relative(process.cwd(), file)}: ${questions.length} questions (split: ${args.split})`);
  console.log(answers
    ? 'Fill in "correctness" for every answered answerable question, then run: score'
    : 'Ask each question, paste the answer, fill in abstained / correctness / citation, then run: score');
}

const judgedOk = (j) => j && !j.abstained && CORRECTNESS.includes(j.correctness);
const rounded = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]));

// The judge's verdicts on the same answers, from the newest saved answers run
async function judgeRows(datasetName) {
  const files = (await readdir(RESULTS_DIR).catch(() => []))
    .filter((f) => f.startsWith(`${datasetName}-answers-`) && f.endsWith('.json') && !f.endsWith('.partial.json')).sort();
  if (!files.length) return [];
  return JSON.parse(await readFile(path.join(RESULTS_DIR, files.at(-1)), 'utf8')).rows;
}

async function score(dataset) {
  const names = args.systems
    ? args.systems.split(',').map((s) => s.trim())
    : (await readdir(SHEETS_DIR).catch(() => []))
      .filter((f) => f.startsWith(`${dataset.name}-`) && f.endsWith('.csv'))
      .map((f) => f.slice(dataset.name.length + 1, -4));
  if (!names.length) throw new Error(`No sheets for ${dataset.name} in ${SHEETS_DIR}. Make one with: sheet`);

  const splits = assignSplits(dataset.questions);
  const judged = await judgeRows(dataset.name);
  const rows = [];
  const summary = [];
  let failed = false;
  for (const system of names) {
    const read = readSheet(parseCsv(await readFile(sheetFile(dataset.name, system), 'utf8')), dataset.questions);
    if (read.problems.length) {
      failed = true;
      console.error(`${system}: fix these in the sheet\n  ${read.problems.join('\n  ')}`);
      continue;
    }
    const mine = read.rows.map((r) => ({ system, split: splits.get(r.id), ...r }));
    rows.push(...mine);
    const pairs = mine.flatMap((r) => {
      const j = judged.find((x) => x.mode === system && x.id === r.id);
      return r.correctness && judgedOk(j) && sameText(j.answer, r.answer) ? [{ a: r.correctness, b: j.correctness }] : [];
    });
    summary.push({
      system, pending: read.pending.length, ...rounded(externalSummary(mine)),
      judgeAgreement: pairs.length ? rounded(agreement(pairs)) : null,
    });
  }
  if (failed) throw new Error('Nothing saved.');
  console.table(summary.map(({ judgeAgreement, ...s }) => ({ ...s, judgeAgreement: judgeAgreement ? `${judgeAgreement.rate} (n=${judgeAgreement.n})` : null })));
  const pending = summary.reduce((n, s) => n + s.pending, 0);
  if (pending) console.log(`${pending} rows are still empty and were left out. A comparison should cover the same questions for every system.`);
  await saveRun({ kind: 'external', dataset: dataset.name, startedAt: new Date().toISOString(), settings: { systems: names }, rows, summary });
}

async function main() {
  const [command, file] = positionals;
  if (!['sheet', 'score'].includes(command) || !file) throw new Error('usage: node eval/external.js sheet|score <dataset.json> [options]');
  const { dataset } = await loadDataset(file);
  await (command === 'sheet' ? sheet(dataset) : score(dataset));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
