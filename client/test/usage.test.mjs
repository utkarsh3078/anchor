import test from 'node:test';
import assert from 'node:assert/strict';
import { duration, usageAlert, usageRows } from '../lib/usage.js';

const model = (extra = {}) => ({
  model: 'gemini-embedding-001', kind: 'embedding',
  limits: { requestsPerMinute: 100, tokensPerMinute: 30000, requestsPerDay: 1000 },
  minute: { requests: 54, tokens: 12000 }, today: { requests: 212, tokens: 50000 }, limited: null, ...extra,
});

test('duration: seconds, minutes, hours', () => {
  assert.deepEqual([duration(0), duration(37), duration(90), duration(3600), duration(5 * 3600 + 12 * 60)], ['1 s', '37 s', '2 min', '1 h', '5 h 12 min']);
});

test('usageRows: used, limit and what is left for the day and the minute', () => {
  const [row] = usageRows({ enabled: true, models: [model()] });
  assert.equal(row.title, 'Reading and searching documents');
  assert.deepEqual(row.today, { used: 212, limit: 1000, left: 788, fraction: 0.212, warn: false, over: false });
  assert.deepEqual([row.minute.used, row.minute.left], [54, 46]);
  assert.deepEqual([row.tokens.used, row.tokens.limit], [12000, 30000]);
  assert.equal(row.limited, null);
});

test('usageRows: a text model has no token meter; over the limit never shows negative', () => {
  const [row] = usageRows({ enabled: true, models: [model({ model: 'gemini-x-flash', kind: 'text', limits: { requestsPerMinute: 5, tokensPerMinute: null, requestsPerDay: 20 }, today: { requests: 23, tokens: 0 }, minute: { requests: 1, tokens: 0 } })] });
  assert.equal(row.title, 'gemini-x-flash');
  assert.equal(row.tokens, null);
  assert.deepEqual(row.today, { used: 23, limit: 20, left: 0, fraction: 1, warn: true, over: true });
});

test('usageRows: the red warning starts at 75% of a limit', () => {
  const at = (requests) => usageRows({ enabled: true, models: [model({ today: { requests, tokens: 0 } })] })[0].today;
  assert.deepEqual([at(749).warn, at(750).warn, at(950).warn, at(1000).warn], [false, true, true, true]);
  assert.deepEqual([at(750).over, at(1000).over], [false, true]);
});

test('usageRows: a refusal from Google is spelled out', () => {
  const minute = usageRows({ enabled: true, models: [model({ limited: { scope: 'minute', retryInSec: 37 } })] })[0];
  assert.match(minute.limited, /per-minute limit is reached\. Try again in 37 s/);
  const day = usageRows({ enabled: true, models: [model({ limited: { scope: 'day', retryInSec: 7200 } })] })[0];
  assert.match(day.limited, /today's limit is reached\. Try again in 2 h/);
});

test('usageRows: tracking off or nothing loaded gives no rows', () => {
  assert.deepEqual(usageRows({ enabled: false }), []);
  assert.deepEqual(usageRows(null), []);
});

const text = (extra = {}) => model({
  model: 'gemini-x-flash', kind: 'text', limits: { requestsPerMinute: 5, tokensPerMinute: null, requestsPerDay: 20 },
  minute: { requests: 0, tokens: 0 }, today: { requests: 0, tokens: 0 }, ...extra,
});
const quiet = { minute: { requests: 0, tokens: 0 }, today: { requests: 0, tokens: 0 } };
const summary = (...models) => ({ enabled: true, resetsInSec: 3 * 3600, models });

test('usageAlert: nothing below 75%, nothing when tracking is off', () => {
  assert.equal(usageAlert(summary(model(quiet), text({ today: { requests: 14, tokens: 0 } })), 'gemini-x-flash'), null);
  assert.equal(usageAlert({ enabled: false }, 'gemini-x-flash'), null);
  assert.equal(usageAlert(null, 'gemini-x-flash'), null);
});

test('usageAlert: 75% of the answer model\'s day is a caution with the numbers and the reset', () => {
  const a = usageAlert(summary(model(quiet), text({ today: { requests: 15, tokens: 0 } })), 'gemini-x-flash');
  assert.equal(a.level, 'warn');
  assert.equal(a.scope, 'day');
  assert.match(a.text, /used 75% of today's limit for gemini-x-flash \(15 of 20\)\. It resets in 3 h\. You can switch/);
});

test('usageAlert: only the embedding model and the model in use count', () => {
  const s = summary(model(quiet), text({ today: { requests: 19, tokens: 0 } }));
  assert.equal(usageAlert(s, 'gemini-other-flash'), null);
  const embed = usageAlert(summary(model({ today: { requests: 900, tokens: 0 }, minute: { requests: 0, tokens: 0 } })), 'gemini-other-flash');
  assert.match(embed.text, /reading and searching documents/);
  assert.doesNotMatch(embed.text, /switch/);
});

test('usageAlert: a used-up limit is a danger and wins over a caution', () => {
  const a = usageAlert(summary(model({ today: { requests: 800, tokens: 0 }, minute: { requests: 0, tokens: 0 } }), text({ today: { requests: 20, tokens: 0 } })), 'gemini-x-flash');
  assert.equal(a.level, 'danger');
  assert.match(a.text, /reached today's limit for gemini-x-flash/);
});

test('usageAlert: per-minute caution, and a refusal from Google names its own scope', () => {
  const minute = usageAlert(summary(model(quiet), text({ minute: { requests: 4, tokens: 0 } })), 'gemini-x-flash');
  assert.deepEqual([minute.level, minute.scope], ['warn', 'minute']);
  assert.match(minute.text, /close to its per-minute limit/);
  const refused = usageAlert(summary(model(quiet), text({ limited: { scope: 'minute', retryInSec: 20 } })), 'gemini-x-flash');
  assert.deepEqual([refused.level, refused.scope], ['danger', 'minute']);
  assert.match(refused.text, /reached its per-minute limit/);
});

test('usageAlert: the id changes when the message does', () => {
  const at = (requests) => usageAlert(summary(model(quiet), text({ today: { requests, tokens: 0 } })), 'gemini-x-flash').id;
  assert.equal(at(15), at(18));
  assert.notEqual(at(18), at(20));
});
