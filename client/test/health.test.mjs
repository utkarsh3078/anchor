import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STATUS_HINT, STATUS_TEXT, statusFrom } from '../lib/health.js';

test('no answer from the server means it is still connecting', () => {
  assert.equal(statusFrom(null), 'connecting');
});

test('200 from /api/health means connected', () => {
  assert.equal(statusFrom({ status: 200 }), 'connected');
});

test('503 (Typesense or MongoDB unreachable) is a server issue, not connecting', () => {
  assert.equal(statusFrom({ status: 503 }), 'degraded');
  assert.equal(statusFrom({ status: 500 }), 'degraded');
});

test('every status has text and a hint', () => {
  for (const s of ['checking', 'connecting', 'connected', 'degraded']) {
    assert.ok(STATUS_TEXT[s] && STATUS_HINT[s], s);
  }
  assert.equal(STATUS_TEXT.connecting, 'Connecting. Please wait');
});
