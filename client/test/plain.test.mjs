import test from 'node:test';
import assert from 'node:assert/strict';
import { abstainText, citedPages, plainError } from '../lib/plain.js';
import { pickDefaultModel } from '../lib/models.js';

const apiError = (code, body = {}) => Object.assign(new Error('raw server text'), { code, body });

test('abstainText: the fixed sentence, plural when several documents were searched', () => {
  assert.equal(abstainText(1), "I couldn't find this in your document.");
  assert.equal(abstainText(), "I couldn't find this in your document.");
  assert.equal(abstainText(3), "I couldn't find this in your documents.");
});

test('plainError: quota offers a model switch and says how long to wait', () => {
  const minute = plainError(apiError('gemini_quota', { scope: 'minute', retryAfterSec: 42 }));
  assert.equal(minute.switchModel, true);
  assert.match(minute.text, /about 42 seconds/);

  const noDelay = plainError(apiError('gemini_quota', { scope: 'minute', retryAfterSec: null }));
  assert.match(noDelay.text, /Wait a minute/);

  const day = plainError(apiError('gemini_quota', { scope: 'day' }));
  assert.equal(day.switchModel, true);
  assert.match(day.text, /tomorrow/);
});

test('plainError: a rejected or missing key asks for the key again', () => {
  for (const code of ['gemini_key_invalid', 'gemini_key_required']) {
    const e = plainError(apiError(code));
    assert.equal(e.changeKey, true);
    assert.equal(e.switchModel, false);
  }
});

test('plainError: an unavailable model offers a switch', () => {
  assert.equal(plainError(apiError('gemini_model_unavailable')).switchModel, true);
});

test('plainError: upload problems are explained', () => {
  assert.match(plainError(apiError('file_too_large')).text, /25 MB/);
  assert.match(plainError(apiError('no_text')).text, /Scanned PDFs/);
});

test('plainError: unknown codes and plain Errors get a generic message, never the raw text', () => {
  for (const err of [apiError('bad_request'), apiError('server_error'), new Error('ECONNRESET at 10.0.0.1'), undefined]) {
    const e = plainError(err);
    assert.equal(e.text, 'Something went wrong. Please try again.');
    assert.deepEqual([e.switchModel, e.changeKey], [false, false]);
  }
});

test('plainError: no message mentions scores, thresholds or retries', () => {
  const codes = ['network', 'gemini_quota', 'gemini_key_invalid', 'gemini_model_unavailable', 'gemini_unavailable',
    'gemini_error', 'cohere_quota', 'cohere_error', 'rerank_unavailable', 'file_too_large', 'no_text', 'not_found', 'other'];
  for (const code of codes) {
    assert.doesNotMatch(plainError(apiError(code)).text, /score|threshold|retr(y|ies) count|rerank|BM25|weight/i);
  }
});

test('citedPages: groups citations by page, in page order, keeping the first passage', () => {
  const citations = [
    { n: 1, id: 'd_4', docName: 'notes.pdf', page: 7, text: 'seven' },
    { n: 2, id: 'd_1', docName: 'notes.pdf', page: 3, text: 'three a' },
    { n: 4, id: 'd_2', docName: 'notes.pdf', page: 3, text: 'three b' },
  ];
  const { multiDoc, pages } = citedPages(citations);
  assert.equal(multiDoc, false);
  assert.deepEqual(pages.map((p) => [p.page, p.numbers]), [[3, [2, 4]], [7, [1]]]);
  assert.equal(pages[0].first.id, 'd_1');
});

test('citedPages: the same page number in two documents stays separate', () => {
  const { multiDoc, pages } = citedPages([
    { n: 1, id: 'b_0', docName: 'b.pdf', page: 2, text: '' },
    { n: 2, id: 'a_0', docName: 'a.pdf', page: 2, text: '' },
  ]);
  assert.equal(multiDoc, true);
  assert.deepEqual(pages.map((p) => p.docName), ['a.pdf', 'b.pdf']);
});

test('citedPages: no citations', () => {
  assert.deepEqual(citedPages([]), { multiDoc: false, pages: [] });
  assert.deepEqual(citedPages(), { multiDoc: false, pages: [] });
});

test('pickDefaultModel: server default if the key has it, else a flash model, else the first', () => {
  const models = [{ id: 'gemini-x-pro' }, { id: 'gemini-x-flash' }];
  assert.equal(pickDefaultModel({ models, defaultModel: 'gemini-x-pro' }), 'gemini-x-pro');
  assert.equal(pickDefaultModel({ models, defaultModel: 'gemini-gone' }), 'gemini-x-flash');
  assert.equal(pickDefaultModel({ models: [{ id: 'gemini-x-pro' }], defaultModel: 'gemini-gone' }), 'gemini-x-pro');
  assert.equal(pickDefaultModel({ models: [], defaultModel: 'gemini-gone' }), 'gemini-gone');
});
