import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '@google/genai';

process.env.GEMINI_API_KEY ||= 'test';
const { MinuteBudget, estimateTokens, planBatches } = await import('../src/lib/pace.js');
const { embedDocuments } = await import('../src/lib/embed.js');

const text = (chars) => 'x'.repeat(chars);

test('estimateTokens: about four characters per token, rounded up', () => {
  assert.deepEqual([estimateTokens(''), estimateTokens('abcd'), estimateTokens('abcde'), estimateTokens(text(900))], [0, 1, 2, 225]);
});

test('planBatches: splits on the text limit', () => {
  const batches = planBatches(Array(250).fill(text(40)), { maxTexts: 100, maxTokens: 1e9 });
  assert.deepEqual(batches.map((b) => [b.start, b.end]), [[0, 100], [100, 200], [200, 250]]);
  assert.equal(batches[0].tokens, 1000);
});

test('planBatches: splits on the token limit before the text limit', () => {
  // 900-character chunks are 225 tokens: 24,000 tokens hold 106 of them, but 100 is the text limit;
  // 1,800-character ones are 450 tokens: 53 fit
  assert.deepEqual(planBatches(Array(120).fill(text(900)), { maxTexts: 100, maxTokens: 24000 }).map((b) => b.end - b.start), [100, 20]);
  assert.deepEqual(planBatches(Array(120).fill(text(1800)), { maxTexts: 100, maxTokens: 24000 }).map((b) => b.end - b.start), [53, 53, 14]);
});

test('planBatches: a text over the token limit goes alone; no texts, no batches', () => {
  const batches = planBatches([text(40), text(400), text(40)], { maxTexts: 100, maxTokens: 50 });
  assert.deepEqual(batches.map((b) => [b.start, b.end, b.tokens]), [[0, 1, 10], [1, 2, 100], [2, 3, 10]]);
  assert.deepEqual(planBatches([], { maxTexts: 100, maxTokens: 50 }), []);
});

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('MinuteBudget: waits until enough of the last minute has passed', () => {
  const c = clock();
  const b = new MinuteBudget({ maxRequests: 100, maxTokens: 24000, now: c.now });
  assert.equal(b.waitFor(100, 22500), 0);
  b.record(100, 22500);
  c.advance(10_000);
  assert.equal(b.waitFor(100, 22500), 50_000); // the first batch leaves the window 60 s after it was sent
  assert.equal(b.waitFor(1, 100), 50_000); // the request limit is full even for one more
  c.advance(50_000);
  assert.equal(b.waitFor(100, 22500), 0);
});

test('MinuteBudget: the token limit alone can make it wait, and only as long as needed', () => {
  const c = clock();
  const b = new MinuteBudget({ maxRequests: 100, maxTokens: 24000, now: c.now });
  b.record(10, 10000);
  c.advance(20_000);
  b.record(10, 10000);
  c.advance(5_000);
  assert.equal(b.waitFor(10, 4000), 0); // 24,000 exactly
  assert.equal(b.waitFor(10, 9000), 35_000); // fits once the first entry is gone
  assert.equal(b.waitFor(10, 20000), 55_000); // needs both gone
});

test('MinuteBudget: something larger than the whole budget goes once the window is empty', () => {
  const c = clock();
  const b = new MinuteBudget({ maxRequests: 100, maxTokens: 24000, now: c.now });
  assert.equal(b.waitFor(1, 50000), 0);
  b.record(1, 100);
  assert.equal(b.waitFor(1, 50000), 60_000);
});

test('MinuteBudget: forget takes a refused request back out', () => {
  const c = clock();
  const b = new MinuteBudget({ maxRequests: 100, maxTokens: 24000, now: c.now });
  const used = b.record(100, 22500);
  b.forget(used);
  assert.equal(b.waitFor(100, 22500), 0);
});

// A fake Gemini client and a fake clock: sleeping just moves the clock
function fakeGemini(failures = []) {
  const calls = [];
  const c = clock();
  const sleeps = [];
  const gemini = {
    keyHash: `test-${Math.random()}`, // a fresh per-key budget for each test
    ai: {
      models: {
        embedContent: async ({ contents }) => {
          calls.push({ at: c.now(), size: contents.length });
          const failure = failures.shift();
          if (failure) throw failure;
          return { embeddings: contents.map((t) => ({ values: [t.length] })) };
        },
      },
    },
  };
  const opts = { pacing: true, limits: { rpm: 100, tpm: 30000 }, now: c.now, sleep: async (ms) => { sleeps.push(ms); c.advance(ms); } };
  return { gemini, calls, sleeps, opts };
}
const quota = (id, delay) => new ApiError({ status: 429, message: `{"quotaId":"${id}","retryDelay":"${delay}s"}` });
const chunks = (n) => Array.from({ length: n }, (_, i) => text(900 - (i % 7)));

test('embedDocuments: a small document is one request with no waiting', async () => {
  const { gemini, calls, sleeps, opts } = fakeGemini();
  const out = await embedDocuments(gemini, chunks(54), opts);
  assert.equal(out.length, 54);
  assert.deepEqual([calls.length, sleeps.length], [1, 0]);
});

test('embedDocuments: a large document is spread over minutes, in order, nothing lost', async () => {
  const { gemini, calls, sleeps, opts } = fakeGemini();
  const texts = chunks(250);
  const out = await embedDocuments(gemini, texts, opts);
  assert.deepEqual(out.map((v) => v[0]), texts.map((t) => t.length));
  assert.deepEqual(calls.map((c) => c.size), [100, 100, 50]);
  assert.deepEqual(sleeps, [60_000, 60_000]);
  // No 60 s window holds more than the limits
  for (const c of calls) {
    const inWindow = calls.filter((o) => o.at > c.at - 60_000 && o.at <= c.at);
    assert.ok(inWindow.reduce((a, o) => a + o.size, 0) <= 100);
  }
});

test('embedDocuments: a per-minute 429 waits the delay Gemini gives and resends only that batch', async () => {
  const { gemini, calls, sleeps, opts } = fakeGemini([null, quota('EmbedContentRequestsPerMinutePerProjectPerModel-FreeTier', 37)]);
  const out = await embedDocuments(gemini, chunks(150), opts);
  assert.equal(out.length, 150);
  assert.deepEqual(calls.map((c) => c.size), [100, 50, 50]); // the first 100 are not embedded again
  assert.deepEqual(sleeps, [60_000, 37_000]);
});

test('embedDocuments: gives up after repeated per-minute refusals', async () => {
  const minute = () => quota('EmbedContentRequestsPerMinutePerProjectPerModel-FreeTier', 30);
  const { gemini, calls, opts } = fakeGemini([minute(), minute(), minute(), minute()]);
  await assert.rejects(embedDocuments(gemini, chunks(10), opts), (e) => e.status === 429);
  assert.equal(calls.length, 4); // the first try and three more
});

test('embedDocuments: a daily limit or another error fails at once', async () => {
  const day = fakeGemini([quota('EmbedContentRequestsPerDayPerProjectPerModel-FreeTier', 5000)]);
  await assert.rejects(embedDocuments(day.gemini, chunks(10), day.opts), (e) => e.status === 429);
  assert.deepEqual([day.calls.length, day.sleeps.length], [1, 0]);

  const other = fakeGemini([new Error('socket hang up')]);
  await assert.rejects(embedDocuments(other.gemini, chunks(10), other.opts), /socket hang up/);
  assert.equal(other.calls.length, 1);
});

test('embedDocuments: pacing off is the earlier behaviour (back-to-back batches, a 429 fails)', async () => {
  const ok = fakeGemini();
  await embedDocuments(ok.gemini, chunks(250), { ...ok.opts, pacing: false });
  assert.deepEqual(ok.calls.map((c) => c.size), [100, 100, 50]);
  assert.equal(ok.sleeps.length, 0);

  const refused = fakeGemini([null, quota('EmbedContentRequestsPerMinutePerProjectPerModel-FreeTier', 37)]);
  await assert.rejects(embedDocuments(refused.gemini, chunks(150), { ...refused.opts, pacing: false }), (e) => e.status === 429);
  assert.equal(refused.calls.length, 2);
});
