import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '@google/genai';
import { geminiContext, geminiHttpError, isPickerModel } from '../src/lib/gemini.js';
import { LruCache, cached } from '../src/lib/cache.js';

const opts = { serverKey: 'server-key', requireUserKey: false, defaultModel: 'gemini-default' };

test('uses the user key from the header, else the server key when allowed', () => {
  const user = geminiContext({ 'x-gemini-key': 'user-key' }, opts);
  const server = geminiContext({}, opts);
  assert.notEqual(user.keyHash, server.keyHash);
  assert.equal(user.keyHash.length, 16);
  assert.ok(!JSON.stringify(user.keyHash).includes('user-key'));
});

test('requires a user key when REQUIRE_USER_KEY is on', () => {
  assert.throws(() => geminiContext({}, { ...opts, requireUserKey: true }), (e) => e.status === 401 && e.code === 'gemini_key_required');
  assert.throws(() => geminiContext({}, { ...opts, serverKey: '' }), (e) => e.code === 'gemini_key_required');
});

test('model headers: default, override, models/ prefix stripped, rewrite model falls back', () => {
  assert.equal(geminiContext({}, opts).model, 'gemini-default');
  const c = geminiContext({ 'x-gemini-model': 'models/gemini-x', 'x-gemini-rewrite-model': 'gemini-lite' }, opts);
  assert.equal(c.model, 'gemini-x');
  assert.equal(c.rewriteModel, 'gemini-lite');
  assert.equal(geminiContext({ 'x-gemini-model': 'gemini-x' }, opts).rewriteModel, 'gemini-x');
  assert.throws(() => geminiContext({ 'x-gemini-model': 'bad model;' }, opts), (e) => e.status === 400);
});

test('cache bypass header', () => {
  assert.equal(geminiContext({}, opts).useCache, true);
  assert.equal(geminiContext({ 'x-anchor-no-cache': '1' }, opts).useCache, false);
});

const apiError = (status, message) => new ApiError({ status, message });

test('daily and per-minute quota errors become 429 gemini_quota with scope, model and retry delay', () => {
  const day = geminiHttpError(apiError(429, '{"error":{"message":"Quota exceeded","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaDimensions":{"model":"gemini-3.6-flash"}},{"retryDelay":"5958s"}]}}'));
  assert.equal(day.status, 429);
  assert.deepEqual([day.body.error, day.body.scope, day.body.model, day.body.retryAfterSec], ['gemini_quota', 'day', 'gemini-3.6-flash', 5958]);
  const minute = geminiHttpError(apiError(429, '{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","retryDelay":"45s"}'));
  assert.equal(minute.body.scope, 'minute');
  assert.equal(minute.body.retryAfterSec, 45);
});

test('invalid key, unknown model, outages and non-Gemini errors', () => {
  assert.equal(geminiHttpError(apiError(400, 'API key not valid. Please pass a valid API key.')).body.error, 'gemini_key_invalid');
  assert.equal(geminiHttpError(apiError(404, 'models/x is not found')).body.error, 'gemini_model_unavailable');
  assert.equal(geminiHttpError(apiError(503, 'overloaded')).status, 503);
  assert.equal(geminiHttpError(new Error('something else')), null);
});

test('LRU cache evicts the least recently used entry', () => {
  const c = new LruCache(2);
  c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('c'), 3);
});

test('cached() reuses values unless disabled', async () => {
  const c = new LruCache(10);
  let calls = 0;
  const fn = async () => ++calls;
  assert.deepEqual(await cached(c, 'k', true, fn), { value: 1, cached: false });
  assert.deepEqual(await cached(c, 'k', true, fn), { value: 1, cached: true });
  assert.deepEqual(await cached(c, 'k', false, fn), { value: 2, cached: false });
});

test('model picker keeps only free-tier flash models of 2.5, 3.5 and 3.6', () => {
  const keep = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash',
    'gemini-3.6-flash-lite', 'gemini-2.5-flash-preview-09-2025'];
  const drop = ['gemini-2.5-pro', 'gemini-3.6-pro', 'gemini-2.0-flash', 'gemini-1.5-flash',
    'gemini-2.5-flash-image', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-live', 'gemini-exp-1206',
    'gemini-embedding-001', 'gemini-25-flash', 'gemma-3-27b-it', '', undefined];
  for (const id of keep) assert.ok(isPickerModel(id), id);
  for (const id of drop) assert.ok(!isPickerModel(id), String(id));
});
