import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.COHERE_API_KEY = 'test-key';
const { rerank } = await import('../src/lib/rerank.js');

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const hits = ['a', 'b', 'c'].map((id) => ({ id, docName: 'd.pdf', page: 1, text: `text ${id}`, score: 0.01 }));

test('reorders hits by Cohere relevance and replaces the score', async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
    return new Response(JSON.stringify({
      results: [{ index: 2, relevance_score: 0.91 }, { index: 0, relevance_score: 0.4 }],
    }));
  };

  const out = await rerank('the query', hits, { topN: 2 });
  assert.deepEqual(out.map((h) => [h.id, h.score]), [['c', 0.91], ['a', 0.4]]);
  assert.deepEqual(Object.keys(out[0]).sort(), ['docName', 'id', 'page', 'score', 'text']);
  assert.equal(sent.auth, 'Bearer test-key');
  assert.deepEqual(sent.body.documents, ['text a', 'text b', 'text c']);
  assert.equal(sent.body.top_n, 2);
});

test('surfaces API errors with the status code', async () => {
  globalThis.fetch = async () => new Response('invalid api token', { status: 401 });
  await assert.rejects(rerank('q', hits), /Cohere rerank failed \(401\)/);
});

test('waits and retries on 429 rate limits', async () => {
  let calls = 0;
  globalThis.fetch = async () => (++calls < 3
    ? new Response('rate limited', { status: 429 })
    : new Response(JSON.stringify({ results: [{ index: 1, relevance_score: 0.8 }] })));
  const out = await rerank('q', hits, { baseDelayMs: 1 });
  assert.equal(calls, 3);
  assert.equal(out[0].id, 'b');
});

test('gives up after maxRetries rate limits', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('rate limited', { status: 429 }); };
  await assert.rejects(rerank('q', hits, { maxRetries: 2, baseDelayMs: 1 }), /\(429\)/);
  assert.equal(calls, 3);
});

test('empty input makes no API call', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  assert.deepEqual(await rerank('q', []), []);
});
