import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { safeWrite, closeDb, mongoEnabled } from '../src/lib/db.js';

export const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function makeApi(base) {
  return async function api(method, route, body) {
    const isForm = body instanceof FormData;
    const res = await fetch(base + route, {
      method,
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : {},
      body: isForm ? body : body && JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${json.error ?? JSON.stringify(json)}`);
    return json;
  };
}

export async function loadDataset(file) {
  const datasetPath = path.resolve(file);
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
  return { dataset, datasetDir: path.dirname(datasetPath) };
}

// Map each dataset document to exactly one indexed docId, so other documents in the
// index can't compete and duplicate uploads can't inflate results.
export async function resolveDocs(api, dataset, datasetDir, { upload = false } = {}) {
  let indexed = await api('GET', '/api/documents');
  const docIds = [];
  for (const doc of dataset.docs) {
    let matches = indexed.filter((d) => d.docName === doc.name);
    if (!matches.length && upload && doc.file) {
      const file = await readFile(path.resolve(datasetDir, doc.file));
      const form = new FormData();
      const type = doc.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain';
      form.append('file', new Blob([file], { type }), doc.name);
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

// Every run is written to eval/results/ and, when configured, to MongoDB (evalRuns)
export async function saveRun(run) {
  await mkdir(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${run.dataset}-${run.kind}-${run.startedAt.replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify(run, null, 2));
  console.log(`Saved ${path.relative(process.cwd(), file)}`);
  if (mongoEnabled()) {
    await safeWrite('evalRuns', (col) => col.insertOne({ ...run, startedAt: new Date(run.startedAt) }));
    console.log('Logged to MongoDB (evalRuns)');
    await closeDb();
  }
}

// Stops a run after `limit` consecutive request errors (e.g. an exhausted daily quota)
// instead of saving a results file that is mostly errors
export function errorGuard(limit = 3) {
  let streak = 0;
  return {
    ok() { streak = 0; },
    fail(e) {
      streak += 1;
      if (streak >= limit) throw new Error(`Aborting after ${limit} consecutive errors; last: ${e.message.slice(0, 300)}`);
    },
  };
}
