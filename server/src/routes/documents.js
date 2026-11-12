import { Router } from 'express';
import multer from 'multer';
import { extractPages } from '../lib/pdf.js';
import { indexDocument } from '../lib/ingest.js';
import { ts, COLLECTION } from '../lib/typesense.js';
import { invalidateKeywordIndex } from '../lib/retrievers.js';
import { collection, safeWrite } from '../lib/db.js';
import { deleteFile, loadFile } from '../lib/files.js';
import { canAccess, canSee, docOwners } from '../lib/scope.js';
import { limitReads, limitUploads, oneUploadAtATime } from '../lib/limits.js';
import { config } from '../config.js';
import { badRequest, sendError, withGemini, withOwner } from './common.js';

// Only what the reader understands: anything else would be read as text and embedded as noise
const ALLOWED = /\.(pdf|txt|md)$/i;
const MAX_NAME = 200;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => (ALLOWED.test(file.originalname)
    ? cb(null, true)
    : cb(Object.assign(new Error('Only PDF, .txt and .md files can be uploaded'), { status: 415, code: 'unsupported_file' }))),
});

// With limits on, a key keeps at most LIMIT_DOCS_PER_KEY documents (Typesense and MongoDB
// space is the server's). Ownerless (older) documents don't count.
async function checkDocumentCount(keyHash) {
  if (!config.limits.enabled || !keyHash) return;
  const owners = await docOwners();
  const own = [...owners.values()].filter((o) => o === keyHash).length;
  if (own >= config.limits.docsPerKey) {
    throw Object.assign(
      new Error(`You can keep up to ${config.limits.docsPerKey} documents. Remove one to add another.`),
      { status: 409, code: 'too_many_documents' },
    );
  }
}

const cleanName = (name) => name.trim().slice(0, MAX_NAME);

// Checks, then indexes, one upload at a time per key
const guardedIndex = (req, build) => oneUploadAtATime(req.gemini.keyHash, async () => {
  await checkDocumentCount(req.gemini.keyHash);
  const { name, pages, ...opts } = await build();
  return indexDocument(cleanName(name), pages, { ...opts, gemini: req.gemini });
});
const router = Router();

// Uploads embed every chunk, so they need the caller's Gemini key (X-Gemini-Key). The
// other routes make no Gemini call; there the key only says whose documents these are
// (lib/scope.js). A document of another key answers 404, the same as one that doesn't exist.
const notFound = (res) => res.status(404).json({ error: 'not_found', message: 'Document not found' });

// Upload + index a PDF or .txt/.md file
router.post('/', withGemini, limitUploads, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw badRequest('No file uploaded (multipart field "file")');
    const { originalname, buffer, size } = req.file;
    // The extension decides (the file filter allows only .pdf, .txt, .md); browsers
    // sometimes send PDFs as application/octet-stream
    const isPdf = /\.pdf$/i.test(originalname);
    res.json(await guardedIndex(req, async () => ({
      name: originalname,
      pages: isPdf ? await extractPages(buffer) : [{ page: 1, text: buffer.toString('utf8') }],
      source: isPdf ? 'pdf' : 'text-file',
      sizeBytes: size,
      file: { buffer, contentType: isPdf ? 'application/pdf' : 'text/plain; charset=utf-8' },
    })));
  } catch (e) {
    sendError(res, e);
  }
});

// Index pasted text: { name, text }
router.post('/text', withGemini, limitUploads, async (req, res) => {
  try {
    const { name, text } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) throw badRequest('name is required');
    if (typeof text !== 'string' || !text.trim()) throw badRequest('text is required');
    res.json(await guardedIndex(req, async () => ({
      name,
      pages: [{ page: 1, text: text.trim() }],
      source: 'paste',
      sizeBytes: Buffer.byteLength(text),
      file: { buffer: Buffer.from(text.trim()), contentType: 'text/plain; charset=utf-8' },
    })));
  } catch (e) {
    sendError(res, e);
  }
});

// List the caller's documents: [{ docId, docName, pages, chunks, uploadedAt? }]
// Typesense is the source of truth for what is searchable; MongoDB adds metadata.
router.get('/', withOwner, limitReads, async (req, res) => {
  try {
    const jsonl = await ts.collections(COLLECTION).documents()
      .export({ include_fields: 'docId,docName,page,owner' });
    const docs = new Map();
    for (const line of jsonl.split('\n').filter(Boolean)) {
      const { docId, docName, page, owner } = JSON.parse(line);
      if (!config.sharedDocuments && !canSee(owner, req.gemini.keyHash)) continue;
      const doc = docs.get(docId) ?? { docId, docName, pages: 0, chunks: 0 };
      doc.chunks++;
      doc.pages = Math.max(doc.pages, page);
      docs.set(docId, doc);
    }

    const col = await collection('documents').catch(() => null);
    if (col) {
      const metas = await col.find({ _id: { $in: [...docs.keys()] } }).toArray();
      for (const m of metas) Object.assign(docs.get(m._id), { source: m.source, uploadedAt: m.uploadedAt });
    }
    res.json([...docs.values()]);
  } catch (e) {
    sendError(res, e);
  }
});

// The original upload, for the source viewer (404 for documents indexed before files were kept)
router.get('/:docId/file', withOwner, limitReads, async (req, res) => {
  try {
    if (!await canAccess(req.params.docId, req.gemini?.keyHash)) return notFound(res);
    const file = await loadFile(req.params.docId);
    if (!file) return res.status(404).json({ error: 'not_found', message: 'Original file not stored. Re-upload the document to view it.' });
    res.set('Content-Type', file.contentType || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(file.buffer);
  } catch (e) {
    sendError(res, e);
  }
});

// Remove a document and all its chunks
router.delete('/:docId', withOwner, limitReads, async (req, res) => {
  try {
    if (!await canAccess(req.params.docId, req.gemini?.keyHash)) return notFound(res);
    const out = await ts.collections(COLLECTION).documents()
      .delete({ filter_by: `docId:=\`${req.params.docId}\`` });
    invalidateKeywordIndex();
    await safeWrite('documents', (col) => col.deleteOne({ _id: req.params.docId }));
    await deleteFile(req.params.docId).catch((e) => console.error('Deleting stored file failed:', e.message));
    res.json(out);
  } catch (e) {
    sendError(res, e);
  }
});

export default router;
