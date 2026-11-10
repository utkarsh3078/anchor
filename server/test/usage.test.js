import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY ||= 'test';
const { createUsage, quotaDay, secondsToReset, limitsFor, mongoUsageStore } = await import('../src/lib/usage.js');
const { embedDocuments } = await import('../src/lib/embed.js');
const { usage } = await import('../src/lib/usage.js');
const { config } = await import('../src/config.js');

const EMBED = config.gemini.embedModel;
const at = (iso) => new Date(iso).getTime();
function tracker(start = '2026-11-10T20:00:00Z') {
  let t = at(start);
  const u = createUsage({ now: () => t, enabled: () => true });
  return { u, advance: (ms) => { t += ms; }, set: (iso) => { t = at(iso); } };
}
const key = (keyHash = 'k1', model = 'gemini-x-flash') => ({ keyHash, model });
const row = (s, model) => s.models.find((m) => m.model === model);

test('quotaDay and secondsToReset follow midnight Pacific', () => {
  assert.equal(quotaDay(at('2026-11-10T07:59:59Z')), '2026-11-09'); // 23:59:59 PST
  assert.equal(quotaDay(at('2026-11-10T08:00:00Z')), '2026-11-10');
  assert.equal(secondsToReset(at('2026-11-10T07:59:59Z')), 1);
  assert.equal(secondsToReset(at('2026-11-10T08:00:00Z')), 86400);
  assert.equal(quotaDay(at('2026-07-01T06:59:59Z')), '2026-06-30'); // PDT in summer
});

test('limitsFor: the embedding model has its own limits, text models share a default', () => {
  const limits = { embedRpm: 100, embedTpm: 30000, embedRpd: 1000, textRpm: 5, textRpd: 20 };
  assert.deepEqual(limitsFor(EMBED, limits), { requestsPerMinute: 100, tokensPerMinute: 30000, requestsPerDay: 1000 });
  assert.deepEqual(limitsFor('gemini-x-flash', limits), { requestsPerMinute: 5, tokensPerMinute: null, requestsPerDay: 20 });
});

test('summary: counts per model for today and for the last minute', async () => {
  const { u, advance } = tracker();
  u.record(key(), EMBED, { requests: 54, tokens: 12000 });
  u.record(key(), 'gemini-x-flash', { tokens: 900 });
  advance(61_000);
  u.record(key(), 'gemini-x-flash', { tokens: 100 });
  const s = await u.summary(key());
  assert.deepEqual([s.enabled, s.estimate, s.day, s.persisted], [true, true, '2026-11-10', false]);
  assert.deepEqual(row(s, EMBED).today, { requests: 54, tokens: 12000 });
  assert.deepEqual(row(s, EMBED).minute, { requests: 0, tokens: 0 }); // older than a minute
  assert.deepEqual(row(s, 'gemini-x-flash').today, { requests: 2, tokens: 1000 });
  assert.deepEqual(row(s, 'gemini-x-flash').minute, { requests: 1, tokens: 100 });
  assert.deepEqual([row(s, EMBED).kind, row(s, 'gemini-x-flash').kind], ['embedding', 'text']);
});

test('summary: lists the embedding model and the answer model even when unused; keys are separate', async () => {
  const { u } = tracker();
  u.record(key('other'), EMBED, { requests: 9 });
  const s = await u.summary(key('k1', 'gemini-y'));
  assert.deepEqual(s.models.map((m) => m.model), [EMBED, 'gemini-y']);
  assert.ok(s.models.every((m) => m.today.requests === 0));
});

test('summary: a new quota day starts from zero', async () => {
  const { u, set } = tracker('2026-11-10T20:00:00Z');
  u.record(key(), EMBED, { requests: 500 });
  set('2026-11-11T09:00:00Z'); // past midnight Pacific
  assert.equal(row(await u.summary(key()), EMBED).today.requests, 0);
});

test('noteLimit: shown until the wait is over; a daily limit until the reset', async () => {
  const { u, advance } = tracker('2026-11-10T20:00:00Z');
  u.noteLimit(key(), { model: 'gemini-x-flash', scope: 'minute', retryAfterSec: 37 });
  u.noteLimit(key(), { model: EMBED, scope: 'day' });
  let s = await u.summary(key());
  assert.deepEqual(row(s, 'gemini-x-flash').limited, { scope: 'minute', retryInSec: 37 });
  assert.deepEqual(row(s, EMBED).limited, { scope: 'day', retryInSec: 12 * 3600 }); // 12:00 PST -> midnight
  advance(38_000);
  s = await u.summary(key());
  assert.equal(row(s, 'gemini-x-flash').limited, null);
  assert.equal(row(s, EMBED).limited.scope, 'day');
});

// A store that keeps what it is given, like the MongoDB one
function fakeStore() {
  const docs = new Map();
  return {
    docs,
    add(keyHash, model, day, requests, tokens) {
      const id = `${keyHash}|${model}|${day}`;
      const d = docs.get(id) ?? { owner: keyHash, model, day, requests: 0, tokens: 0 };
      docs.set(id, { ...d, requests: d.requests + requests, tokens: d.tokens + tokens });
    },
    async read(keyHash, day) { return [...docs.values()].filter((d) => d.owner === keyHash && d.day === day); },
  };
}

test('with a store: today\'s counts survive a restart and are not counted twice', async () => {
  const store = fakeStore();
  const first = tracker();
  first.u.attachStore(store);
  first.u.record(key(), EMBED, { requests: 54, tokens: 12000 });
  first.u.record(key(), 'gemini-x-flash', { tokens: 500 });
  assert.equal(row(await first.u.summary(key()), EMBED).today.requests, 54); // memory and store agree: 54, not 108

  const restarted = tracker(); // a new process: empty memory, same store
  restarted.u.attachStore(store);
  let s = await restarted.u.summary(key());
  assert.equal(s.persisted, true);
  assert.deepEqual(row(s, EMBED).today, { requests: 54, tokens: 12000 });
  restarted.u.record(key(), EMBED, { requests: 10, tokens: 2000 });
  s = await restarted.u.summary(key());
  assert.deepEqual(row(s, EMBED).today, { requests: 64, tokens: 14000 });
  assert.equal(row(s, 'gemini-x-flash').today.requests, 1); // a model used only before the restart is still listed
});

test('with a store that cannot be read: memory is used and persisted is false', async () => {
  const { u } = tracker();
  u.attachStore({ add() {}, read: async () => null });
  u.record(key(), EMBED, { requests: 3 });
  const s = await u.summary(key());
  assert.deepEqual([s.persisted, row(s, EMBED).today.requests], [false, 3]);
});

test('mongoUsageStore: one upserted document per key hash, model and day', async () => {
  const calls = [];
  const col = { updateOne: async (...a) => { calls.push(a); }, find: (q) => ({ toArray: async () => [{ model: EMBED, requests: 5, tokens: 9, q }] }) };
  const store = mongoUsageStore({ safeWrite: (name, fn) => fn(col), collection: async () => col });
  store.add('abc', EMBED, '2026-11-10', 54, 12000);
  assert.deepEqual(calls[0][0], { _id: `abc|${EMBED}|2026-11-10` });
  assert.deepEqual(calls[0][1].$inc, { requests: 54, tokens: 12000 });
  assert.deepEqual(calls[0][2], { upsert: true });
  assert.equal(JSON.stringify(calls[0]).includes('AIza'), false);
  const [doc] = await store.read('abc', '2026-11-10');
  assert.deepEqual(doc.q, { owner: 'abc', day: '2026-11-10' });
  const down = mongoUsageStore({ safeWrite: () => {}, collection: async () => null });
  assert.equal(await down.read('abc', '2026-11-10'), null);
});

test('off: nothing is counted', async () => {
  const u = createUsage({ enabled: () => false });
  u.record(key(), EMBED, { requests: 5 });
  assert.deepEqual(await u.summary(key()), { enabled: false });
});

test('a request without a key hash is not counted', async () => {
  const { u } = tracker();
  u.record({ model: 'm' }, EMBED, { requests: 5 });
  assert.equal(row(await u.summary(key()), EMBED).today.requests, 0);
});

test('embedDocuments records one request per text on the server tracker', { skip: !config.usageTracking && 'USAGE_TRACKING=false in .env' }, async () => {
  const gemini = { keyHash: `usage-${Math.random()}`, model: 'm', ai: { models: { embedContent: async ({ contents }) => ({ embeddings: contents.map(() => ({ values: [1] })) }) } } };
  await embedDocuments(gemini, ['x'.repeat(40), 'y'.repeat(80)], { pacing: false });
  const s = await usage.summary(gemini);
  assert.deepEqual(row(s, EMBED).today, { requests: 2, tokens: 30 });
});
