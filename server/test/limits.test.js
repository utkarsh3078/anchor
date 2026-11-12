import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WindowCounter, MinutePacer, rateLimit, takeCohereCall, oneUploadAtATime } from '../src/lib/limits.js';
import { parseParams } from '../src/routes/common.js';
import { indexDocument } from '../src/lib/ingest.js';

const clock = (t = 0) => { const c = () => t; c.add = (ms) => { t += ms; }; return c; };

test('WindowCounter: per-minute limit, then the window resets', () => {
  const now = clock();
  const c = new WindowCounter({ perMinute: 2, now });
  c.take('a'); c.take('a');
  assert.deepEqual(c.check('a'), { ok: false, scope: 'minute', retryAfterSec: 60 });
  assert.equal(c.check('b').ok, true, 'ids are counted apart');
  now.add(60_000);
  assert.equal(c.check('a').ok, true);
});

test('WindowCounter: the daily limit wins over the minute', () => {
  const now = clock();
  const c = new WindowCounter({ perMinute: 10, perDay: 3, now });
  for (let i = 0; i < 3; i++) { c.take('a'); now.add(61_000); }
  const v = c.check('a');
  assert.equal(v.scope, 'day');
  assert.ok(v.retryAfterSec > 23 * 3600);
});

function call(mw, req) {
  const res = { statusCode: 200, headers: {}, body: null };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (s) => { res.statusCode = s; return res; };
  res.json = (b) => { res.body = b; return res; };
  let passed = false;
  mw(req, res, () => { passed = true; });
  return { passed, res };
}

test('rateLimit: limits per key and per IP, 429 with Retry-After', () => {
  const mw = rateLimit('questions', { key: { perMinute: 2 }, ip: { perMinute: 3 } }, { enabled: () => true, now: clock() });
  const req = (key, ip) => ({ gemini: { keyHash: key }, ip });
  assert.equal(call(mw, req('k1', '1.1.1.1')).passed, true);
  assert.equal(call(mw, req('k1', '1.1.1.1')).passed, true);
  const third = call(mw, req('k1', '1.1.1.1'));
  assert.equal(third.passed, false);
  assert.equal(third.res.statusCode, 429);
  assert.equal(third.res.body.error, 'rate_limited');
  assert.equal(third.res.headers['Retry-After'], '60');
  // A new key from the same IP: the IP allows one more (the refused request was not counted)
  assert.equal(call(mw, req('k2', '1.1.1.1')).passed, true);
  assert.equal(call(mw, req('k3', '1.1.1.1')).passed, false, 'rotating keys does not get past the IP limit');
});

test('rateLimit: off = everything passes', () => {
  const mw = rateLimit('questions', { key: { perMinute: 0 } }, { enabled: () => false });
  assert.equal(call(mw, { gemini: { keyHash: 'k' }, ip: 'x' }).passed, true);
});

test('Cohere daily budget throws cohere_budget when spent, and nothing when limits are off', () => {
  const now = clock();
  takeCohereCall({ enabled: true, perDay: 2, now });
  takeCohereCall({ enabled: true, perDay: 2, now });
  assert.throws(() => takeCohereCall({ enabled: true, perDay: 2, now }), { code: 'cohere_budget', status: 503 });
  assert.doesNotThrow(() => takeCohereCall({ enabled: false, perDay: 2, now }));
});

test('one upload at a time per key', async () => {
  let release;
  const first = oneUploadAtATime('k', () => new Promise((r) => { release = r; }));
  await assert.rejects(oneUploadAtATime('k', async () => 'x'), { code: 'upload_in_progress' });
  assert.equal(await oneUploadAtATime('other', async () => 'ok'), 'ok');
  release('done');
  assert.equal(await first, 'done');
  assert.equal(await oneUploadAtATime('k', async () => 'again'), 'again', 'the lock is released');
});

test('parseParams caps query length, candidates and docIds', () => {
  assert.throws(() => parseParams({ query: 'x'.repeat(11) }, { maxQueryChars: 10 }), { code: 'query_too_long' });
  assert.equal(parseParams({ query: ' ok ' }, { maxQueryChars: 10 }).query, 'ok');
  assert.throws(() => parseParams({ query: 'q', candidates: 101 }), /candidates/);
  assert.throws(() => parseParams({ query: 'q', docIds: Array(101).fill('d') }), /docIds/);
  assert.throws(() => parseParams({ query: 'q', docIds: [{ $ne: 1 }] }), /docIds/);
  assert.throws(() => parseParams(null), /query is required/);
});

test('a document over the chunk cap is refused before any embedding call', async () => {
  const gemini = { keyHash: 'k', ai: { models: { embedContent: () => assert.fail('embedding must not be called') } } };
  const pages = [{ page: 1, text: 'A sentence long enough to be kept as a chunk. '.repeat(200) }];
  await assert.rejects(indexDocument('big', pages, { gemini, maxChunks: 3 }), { code: 'too_many_chunks', status: 422 });
});

test('Cohere pacer: 10 a minute go at once, the 11th waits for the oldest to leave the minute', async () => {
  const now = clock(0);
  const waits = [];
  const p = new MinutePacer({ perMinute: 10, maxWaitMs: 30_000, now, sleep: async (ms) => { waits.push(ms); } });
  for (let i = 0; i < 10; i++) { assert.equal(await p.wait(), 0); now.add(1000); } // t = 10 s
  now.add(25_000); // t = 35 s; the first call (t = 0) leaves the window at 60 s
  assert.equal(await p.wait(), 25_000);
  assert.deepEqual(waits, [25_000]);
});

test('Cohere pacer: concurrent callers get different slots; too long a wait is refused', async () => {
  const now = clock(0);
  const p = new MinutePacer({ perMinute: 2, maxWaitMs: 30_000, now, sleep: async () => {} });
  await p.wait(); await p.wait();             // t = 0: the minute is full
  now.add(40_000);                             // t = 40 s: next slot at 60 s, 20 s away
  const [a, b] = await Promise.allSettled([p.wait(), p.wait()]);
  assert.equal(a.value, 20_000);               // takes the 60 s slot
  assert.equal(b.value, 20_000);               // the second call at t = 0 also frees at 60 s
  await assert.rejects(p.wait(), (e) => e.code === 'cohere_quota' && e.status === 429 && e.retryAfterSec === 80);
  assert.equal(await new MinutePacer({ perMinute: 0, now }).wait(), 0, '0 = off');
});
