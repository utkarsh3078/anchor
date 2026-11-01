import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.TYPESENSE_API_KEY ||= 'test';
const { ts } = await import('../src/lib/typesense.js');
const { withNeighbours } = await import('../src/lib/context.js');

const hit = (id, page = 1) => ({ id, docName: 'd.pdf', page, text: `text ${id}`, score: 0.5 });

test('adds previous and next chunks beside the top hits, in reading order, without duplicates', async () => {
  let filter;
  const stored = ['doc-1_4', 'doc-1_6', 'doc-1_8', 'doc-2_0', 'doc-2_2'];
  mock.method(ts.multiSearch, 'perform', async ({ searches }) => {
    filter = searches[0].filter_by;
    return { results: [{ hits: stored.map((id) => ({ document: { id, docName: 'd.pdf', page: 2, text: `n ${id}` } })) }] };
  });
  const hits = [hit('doc-1_5'), hit('doc-1_7'), hit('doc-2_1'), hit('doc-3_9')];
  const out = await withNeighbours(hits, { around: 3 });
  assert.deepEqual(out.map((p) => p.id), ['doc-1_4', 'doc-1_5', 'doc-1_6', 'doc-1_7', 'doc-1_8', 'doc-2_0', 'doc-2_1', 'doc-2_2', 'doc-3_9']);
  assert.equal(out.find((p) => p.id === 'doc-1_4').neighbour, true);
  assert.equal(out.find((p) => p.id === 'doc-1_5').neighbour, undefined);
  assert.ok(filter.includes('`doc-1_4`') && !filter.includes('doc-3_8'));
  mock.restoreAll();
});

test('chunk 0 has no previous chunk; a Typesense failure falls back to the hits', async () => {
  mock.method(ts.multiSearch, 'perform', async () => { throw new Error('down'); });
  const hits = [hit('doc-1_0')];
  assert.deepEqual(await withNeighbours(hits), hits);
  mock.restoreAll();
});
