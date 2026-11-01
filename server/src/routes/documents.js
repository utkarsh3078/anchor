import { Router } from 'express';
import multer from 'multer';
import { extractPages } from '../lib/pdf.js';
import { indexDocument } from '../lib/ingest.js';
import { ts, COLLECTION } from '../lib/typesense.js';
import { invalidateKeywordIndex } from '../lib/retrievers.js';
import { collection, safeWrite } from '../lib/db.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
const router = Router();

const fail = (res, e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.message });
};

// Upload + index a PDF or .txt/.md file
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { originalname, mimetype, buffer, size } = req.file;
    // Browsers sometimes send PDFs as application/octet-stream, so check the extension too
    const isPdf = mimetype === 'application/pdf' || /\.pdf$/i.test(originalname);
    const pages = isPdf ? await extractPages(buffer) : [{ page: 1, text: buffer.toString('utf8') }];
    res.json(await indexDocument(originalname, pages, { source: isPdf ? 'pdf' : 'text-file', sizeBytes: size }));
  } catch (e) {
    fail(res, e);
  }
});

// Index pasted text: { name, text }
router.post('/text', async (req, res) => {
  try {
    const { name, text } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name is required' });
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });
    const pages = [{ page: 1, text: text.trim() }];
    res.json(await indexDocument(name.trim(), pages, { source: 'paste', sizeBytes: Buffer.byteLength(text) }));
  } catch (e) {
    fail(res, e);
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
    fail(res, e);
  }
});

// Remove a document and all its chunks
router.delete('/:docId', async (req, res) => {
  try {
    const out = await ts.collections(COLLECTION).documents()
      .delete({ filter_by: `docId:=\`${req.params.docId}\`` });
    invalidateKeywordIndex();
    await safeWrite('documents', (col) => col.deleteOne({ _id: req.params.docId }));
    res.json(out);
  } catch (e) {
    fail(res, e);
  }
});

export default router;
