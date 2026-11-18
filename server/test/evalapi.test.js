import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApi } from '../eval/common.js';

// Fake fetch: answers with the queued responses in order
function fakeFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const { status, body } = responses.shift();
    return { ok: status < 400, status, json: async () => body };
  };
  return calls;
}
const quota = (scope, retryAfterSec) => ({ status: 429, body: { error: 'gemini_quota', scope, retryAfterSec, message: 'limit' } });
const quiet = { log: () => {} };

test('eval api: a per-minute Gemini limit waits and sends the request again', async () => {
  const calls = fakeFetch([quota('minute', 7), { status: 200, body: { ok: 1 } }]);
  const waits = [];
  const api = makeApi('http://x', {}, { ...quiet, wait: async (ms) => waits.push(ms) });
  assert.deepEqual(await api('POST', '/api/search/hybrid', { query: 'q' }), { ok: 1 });
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [9000]); // Gemini's delay + 2 s
});

test('eval api: a daily limit or another error is thrown at once', async () => {
  fakeFetch([quota('day', null)]);
  const api = makeApi('http://x', {}, { ...quiet, wait: async () => assert.fail('must not wait') });
  await assert.rejects(api('GET', '/r'), (e) => e.code === 'gemini_quota' && e.scope === 'day');
  fakeFetch([{ status: 400, body: { error: 'bad_request', message: 'no' } }]);
  await assert.rejects(api('GET', '/r'), (e) => e.code === 'bad_request');
});

test('eval api: gives up after three per-minute waits', async () => {
  const calls = fakeFetch([quota('minute'), quota('minute'), quota('minute'), quota('minute')]);
  const waits = [];
  const api = makeApi('http://x', {}, { ...quiet, wait: async (ms) => waits.push(ms) });
  await assert.rejects(api('GET', '/r'), (e) => e.code === 'gemini_quota');
  assert.equal(calls.length, 4);
  assert.deepEqual(waits, [62000, 62000, 62000]); // no delay given: a minute
});

test('eval api: Gemini busy (503) is retried twice, 15 s apart', async () => {
  const busy = { status: 503, body: { error: 'gemini_unavailable', message: 'busy' } };
  const calls = fakeFetch([busy, busy, { status: 200, body: { ok: 1 } }]);
  const waits = [];
  const api = makeApi('http://x', {}, { ...quiet, wait: async (ms) => waits.push(ms) });
  assert.deepEqual(await api('POST', '/api/ask', {}), { ok: 1 });
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [15000, 15000]);
});

test('eval api: a dropped connection is retried once', async () => {
  let n = 0;
  globalThis.fetch = async () => {
    n += 1;
    if (n === 1) throw new TypeError('fetch failed');
    return { ok: true, status: 200, json: async () => ({ ok: 2 }) };
  };
  const api = makeApi('http://x', {}, { ...quiet, wait: async () => {} });
  assert.deepEqual(await api('POST', '/api/ask', {}), { ok: 2 });
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(api('POST', '/api/ask', {}), /fetch failed/);
});
