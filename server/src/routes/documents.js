import { Router } from 'express';
import multer from 'multer';
import { extractPages } from '../lib/pdf.js';
import { indexDocument } from '../lib/ingest.js';
import { ts, COLLECTION } from '../lib/typesense.js';
import { invalidateKeywordIndex } from '../lib/retrievers.js';
import { collection, safeWrite } from '../lib/db.js';
import { deleteFile, loadFile } from '../lib/files.js';
import { badRequest, sendError, withGemini } from './common.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
const router = Router();

// Uploads embed every chunk, so they need the caller's Gemini key (X-Gemini-Key)

// Upload + index a PDF or .txt/.md file
router.post('/', withGemini, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw badRequest('No file uploaded (multipart field "file")');
    const { originalname, mimetype, buffer, size } = req.file;
    // Browsers sometimes send PDFs as application/octet-stream, so check the extension too
    const isPdf = mimetype === 'application/pdf' || /\.pdf$/i.test(originalname);
    const pages = isPdf ? await extractPages(buffer) : [{ page: 1, text: buffer.toString('utf8') }];
    res.json(await indexDocument(originalname, pages, {
      source: isPdf ? 'pdf' : 'text-file',
      sizeBytes: size,
      gemini: req.gemini,
      file: { buffer, contentType: isPdf ? 'application/pdf' : 'text/plain; charset=utf-8' },
    }));
  } catch (e) {
    sendError(res, e);
  }
});

// Index pasted text: { name, text }
router.post('/text', withGemini, async (req, res) => {
  try {
    const { name, text } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) throw badRequest('name is required');
    if (typeof text !== 'string' || !text.trim()) throw badRequest('text is required');
    const pages = [{ page: 1, text: text.trim() }];
    res.json(await indexDocument(name.trim(), pages, {
      source: 'paste',
      sizeBytes: Buffer.byteLength(text),
      gemini: req.gemini,
      file: { buffer: Buffer.from(text.trim()), contentType: 'text/plain; charset=utf-8' },
    }));
  } catch (e) {
    sendError(res, e);
  }
});

// List indexed documents: [{ docId, docName, pages, chunks, uploadedAt? }]
// Typesense is the source of truth for what is searchable; MongoDB adds metadata.
router.get('/', async (_req, res) => {
  try {
    const jsonl = await ts.collections(COLLECTION).documents()
      .export({ include_fields: 'docId,docName,page' });
    const docs = new Map();
    for (const line of jsonl.split('\n').filter(Boolean)) {
      const { docId, docName, page } = JSON.parse(line);
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
router.get('/:docId/file', async (req, res) => {
  try {
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
router.delete('/:docId', async (req, res) => {
  try {
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
