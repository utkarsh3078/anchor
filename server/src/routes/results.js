import { Router } from 'express';
import { loadResults, resultsDataset } from '../lib/results.js';
import { limitReads } from '../lib/limits.js';
import { sendError } from './common.js';

const router = Router();

// Measured evaluation results for the public results page. No key needed and no API call:
// it reads the saved evaluation runs (lib/results.js) and returns totals only.
// ?dataset=<name> picks another dataset (default RESULTS_DATASET, else real-core).
// Cached for a minute, so a busy page doesn't read MongoDB on every visit.
const CACHE_MS = 60_000;
const cache = new Map();

router.get('/', limitReads, async (req, res) => {
  try {
    const dataset = req.query.dataset ?? resultsDataset();
    if (typeof dataset !== 'string' || !/^[\w.-]{1,60}$/.test(dataset)) {
      throw Object.assign(new Error('dataset must be a dataset name'), { status: 400, code: 'bad_request' });
    }
    const hit = cache.get(dataset);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.body);
    const body = await loadResults(dataset);
    if (!body) throw Object.assign(new Error(`No evaluation runs for ${dataset} yet`), { status: 404, code: 'not_found' });
    cache.set(dataset, { at: Date.now(), body });
    res.json(body);
  } catch (e) {
    sendError(res, e);
  }
});

export default router;
