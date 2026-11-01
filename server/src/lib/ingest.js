import { randomUUID } from 'crypto';
import { chunkPages } from './chunk.js';
import { embedDocuments } from './embed.js';
import { ts, COLLECTION } from './typesense.js';
import { invalidateKeywordIndex } from './retrievers.js';
import { safeWrite } from './db.js';
import { saveFile } from './files.js';

// pages: [{ page, text }]. Chunks, embeds and indexes one document; records its
// metadata in MongoDB when configured. file = { buffer, contentType } of the original,
// stored so the client can open the cited page.
export async function indexDocument(docName, pages, { source, sizeBytes, gemini, file }) {
  const chunks = chunkPages(pages);
  if (!chunks.length) {
    throw Object.assign(new Error('No extractable text (scanned PDF?)'), { status: 422, code: 'no_text' });
  }

  const docId = randomUUID();
  const vectors = await embedDocuments(gemini, chunks.map((c) => c.text));
  const docs = chunks.map((c, i) => ({
    id: `${docId}_${c.chunkIndex}`,
    docId,
    docName,
    page: c.page,
    chunkIndex: c.chunkIndex,
    text: c.text,
    embedding: vectors[i],
  }));

  // throwOnFail defaults to true in typesense-js, which would hide partial failures behind a 500
  const results = await ts.collections(COLLECTION).documents()
    .import(docs, { action: 'create', throwOnFail: false });
  invalidateKeywordIndex();
  const failed = results.filter((r) => !r.success);
  if (failed.length) console.error('Import failures:', failed.slice(0, 3));

  // The document is searchable even if storing the original fails; only the viewer is affected
  if (file) {
    await saveFile(docId, file.buffer, { filename: docName, contentType: file.contentType })
      .catch((e) => console.error(`Storing original of ${docName} failed:`, e.message));
  }

  const meta = { docId, docName, pages: pages.length, chunks: chunks.length, failed: failed.length };
  await safeWrite('documents', (col) => col.insertOne({
    _id: docId, ...meta, source, sizeBytes, uploadedAt: new Date(),
  }));
  return meta;
}
