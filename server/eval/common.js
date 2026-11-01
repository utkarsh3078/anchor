import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { safeWrite, closeDb, mongoEnabled } from '../src/lib/db.js';

export const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

// Headers the server reads for Gemini (see src/lib/gemini.js). The key comes from
// GEMINI_API_KEY in .env; caches are bypassed so latencies are real calls.
export function geminiHeaders({ model, rewriteModel } = {}) {
  const h = { 'X-Anchor-No-Cache': '1' };
  if (process.env.GEMINI_API_KEY) h['X-Gemini-Key'] = process.env.GEMINI_API_KEY;
  if (model) h['X-Gemini-Model'] = model;
  if (rewriteModel) h['X-Gemini-Rewrite-Model'] = rewriteModel;
  return h;
}

export function makeApi(base, extraHeaders = {}) {
  return async function api(method, route, body) {
    const isForm = body instanceof FormData;
    const res = await fetch(base + route, {
      method,
      headers: { ...extraHeaders, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: isForm ? body : body && JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      const err = new Error(`${method} ${route} -> ${res.status} ${json.error}: ${json.message ?? ''}`);
      throw Object.assign(err, { status: res.status, code: json.error, scope: json.scope });
    }
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

// Progress is saved after every question to <name>.partial.json, so a run cut short by
// a quota can continue later (possibly with another model) via --resume <that file>.
// On resume the saved settings are used, so all rows share k, configs and thresholds.
export async function openCheckpoint({ kind, dataset, settings, resume }) {
  let state = { kind, dataset, startedAt: new Date().toISOString(), settings, rows: [] };
  if (resume) {
    const saved = JSON.parse(await readFile(resume, 'utf8'));
    if (saved.kind !== kind || saved.dataset !== dataset) {
      throw new Error(`${resume} is a ${saved.kind} run of ${saved.dataset}, not ${kind} of ${dataset}`);
    }
    state = { ...saved, rows: saved.rows.filter((r) => !r.error) }; // failed rows run again
    console.log(`Resuming ${resume}: ${state.rows.length} rows already done`);
  }
  await mkdir(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${dataset}-${kind}-${state.startedAt.replace(/[:.]/g, '-')}.partial.json`);
  const save = () => writeFile(file, JSON.stringify(state, null, 2));

  return {
    file,
    settings: state.settings,
    rows: state.rows,
    // Rows are labelled by `config` (retrieval runs) or `mode` (answer runs)
    find: (label, id) => state.rows.find((r) => (r.config ?? r.mode) === label && r.id === id),
    isDone: (label, id) => state.rows.some((r) => (r.config ?? r.mode) === label && r.id === id),
    save,
    async add(row) {
      state.rows.push(row);
      await save();
    },
    async finish(summary) {
      await saveRun({ ...state, summary });
      await rm(file, { force: true });
      if (resume && path.resolve(resume) !== file) await rm(resume, { force: true });
    },
  };
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

// Errors that won't go away by trying the next question
const FATAL = new Set(['gemini_key_required', 'gemini_key_invalid', 'gemini_model_unavailable', 'rerank_unavailable']);

// Stops a run on a fatal error or a daily quota at once, otherwise after `limit`
// consecutive errors, instead of saving a results file that is mostly errors
export function errorGuard(limit = 3) {
  let streak = 0;
  return {
    ok() { streak = 0; },
    fail(e) {
      streak += 1;
      const fatal = FATAL.has(e.code) || (e.code === 'gemini_quota' && e.scope === 'day');
      if (fatal || streak >= limit) {
        throw new Error(`Stopping: ${fatal ? 'cannot continue' : `${limit} consecutive errors`}. Last: ${e.message.slice(0, 300)}`);
      }
    },
  };
}
