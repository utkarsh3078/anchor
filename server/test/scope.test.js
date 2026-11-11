import { test } from 'node:test';
import assert from 'node:assert/strict';
// scope.js pulls in the Typesense client, which needs a key at import time
process.env.TYPESENSE_API_KEY ||= 'test';
const { canSee, scopeDocIds, NO_DOCUMENTS } = await import('../src/lib/scope.js');

const owners = new Map([['a1', 'alice'], ['a2', 'alice'], ['b1', 'bob'], ['old', undefined]]);

test('a key sees its own documents and the ones indexed before owners existed', () => {
  assert.equal(canSee('alice', 'alice'), true);
  assert.equal(canSee(undefined, 'alice'), true);
  assert.equal(canSee('bob', 'alice'), false);
});

test('no docIds requested = all of the caller\'s documents, never everyone\'s', () => {
  assert.deepEqual(scopeDocIds([], owners, 'alice'), ['a1', 'a2', 'old']);
  assert.deepEqual(scopeDocIds([], owners, 'bob'), ['b1', 'old']);
});

test('requested docIds of another key, or unknown ones, are dropped', () => {
  assert.deepEqual(scopeDocIds(['a1', 'b1', 'nope'], owners, 'alice'), ['a1']);
  assert.deepEqual(scopeDocIds(['old', 'b1'], owners, 'bob'), ['old', 'b1']);
});

test('nothing visible gives a filter that matches nothing, not the empty "no filter" list', () => {
  assert.deepEqual(scopeDocIds(['b1'], owners, 'alice'), NO_DOCUMENTS);
  assert.deepEqual(scopeDocIds([], new Map([['b1', 'bob']]), 'alice'), NO_DOCUMENTS);
  assert.deepEqual(scopeDocIds([], new Map(), 'alice'), NO_DOCUMENTS);
  assert.ok(NO_DOCUMENTS.length > 0);
});

test('when every document is visible and none was picked, no filter is added (as before owners)', () => {
  assert.deepEqual(scopeDocIds([], new Map([['a1', 'alice'], ['old', undefined]]), 'alice'), []);
  assert.deepEqual(scopeDocIds(['a1'], new Map([['a1', 'alice'], ['old', undefined]]), 'alice'), ['a1']);
});
