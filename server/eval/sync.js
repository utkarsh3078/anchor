// Puts a saved run file into MongoDB (evalRuns), replacing any record of the same run
// (same dataset, kind and startedAt). Use it after editing a run file, e.g. after grading
// answers by hand, so the report and the results page (GET /api/results) read the same rows.
//   node eval/sync.js eval/results/<run>.json
import 'dotenv/config';
import { readFile } from 'fs/promises';
import { collection, closeDb, mongoEnabled } from '../src/lib/db.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node eval/sync.js <run.json>');
  process.exit(1);
}
if (!mongoEnabled()) {
  console.error('MONGODB_URI is not set: nothing to sync (the results page reads the files directly)');
  process.exit(1);
}
const run = JSON.parse(await readFile(file, 'utf8'));
if (!run.kind || !run.dataset || !run.startedAt || !Array.isArray(run.rows)) {
  console.error(`${file} is not a finished run file (needs kind, dataset, startedAt and rows)`);
  process.exit(1);
}
const col = await collection('evalRuns');
const startedAt = new Date(run.startedAt);
const { deletedCount } = await col.deleteMany({ dataset: run.dataset, kind: run.kind, startedAt });
await col.insertOne({ ...run, startedAt });
console.log(`${run.dataset} ${run.kind} ${run.startedAt}: replaced ${deletedCount} record(s) with the file`);
await closeDb();
