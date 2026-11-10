import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, askBody, isDefault, loadPrefs, savePrefs } from '../lib/settings.js';

const fakeStorage = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data };
};

test('askBody: default settings send only query, k and docIds', () => {
  assert.deepEqual(askBody({ query: 'q', docIds: ['a'] }), { query: 'q', k: 10, docIds: ['a'] });
  assert.deepEqual(askBody({ query: 'q', docIds: [], chatId: 'c1', settings: { ...DEFAULTS } }), { query: 'q', k: 10, docIds: [], chatId: 'c1' });
});

test('askBody: changed anchor settings are sent', () => {
  const body = askBody({ query: 'q', docIds: [], settings: { ...DEFAULTS, k: 5, threshold: 0.3, strict: true, maxRetries: 0 } });
  assert.deepEqual(body, { query: 'q', k: 5, docIds: [], threshold: 0.3, strict: true, maxRetries: 0 });
});

test('askBody: baselines send the mode and no anchor-only settings', () => {
  const body = askBody({ query: 'q', docIds: [], settings: { ...DEFAULTS, mode: 'hybrid', threshold: 0.4, strict: true } });
  assert.deepEqual(body, { query: 'q', k: 10, docIds: [], mode: 'hybrid' });
});

test('isDefault', () => {
  assert.equal(isDefault({ ...DEFAULTS }), true);
  assert.equal(isDefault({ ...DEFAULTS, threshold: 0.2 }), false);
});

test('loadPrefs: defaults when nothing is stored, storage is missing, or it throws', () => {
  const defaults = { settings: { ...DEFAULTS }, showDetails: false };
  assert.deepEqual(loadPrefs(fakeStorage()), defaults);
  assert.deepEqual(loadPrefs(undefined), defaults);
  assert.deepEqual(loadPrefs({ getItem: () => { throw new Error('denied'); } }), defaults);
  assert.deepEqual(loadPrefs(fakeStorage({ 'anchor.advanced': '{not json' })), defaults);
});

test('loadPrefs/savePrefs: round trip', () => {
  const storage = fakeStorage();
  const prefs = { settings: { ...DEFAULTS, mode: 'dense', k: 7 }, showDetails: true };
  savePrefs(prefs, storage);
  assert.deepEqual(loadPrefs(storage), prefs);
});

test('loadPrefs: invalid stored values fall back field by field', () => {
  const storage = fakeStorage({
    'anchor.advanced': JSON.stringify({ settings: { mode: 'graph', k: 99, threshold: 0.25, maxRetries: 1.5, strict: 'yes' }, showDetails: 'true' }),
  });
  assert.deepEqual(loadPrefs(storage), { settings: { ...DEFAULTS, threshold: 0.25 }, showDetails: false });
});

test('savePrefs: storage that throws is ignored', () => {
  assert.doesNotThrow(() => savePrefs({}, { setItem: () => { throw new Error('quota'); } }));
});
