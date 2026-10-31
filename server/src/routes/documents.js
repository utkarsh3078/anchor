import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { extractPages } from '../lib/pdf.js';
import { chunkPages } from '../lib/chunk.js';
import { embedDocuments } from '../lib/embed.js';
import { ts, COLLECTION } from '../lib/typesense.js';
import { invalidateKeywordIndex } from '../lib/retrievers.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
const router = Router();

// Upload + index a PDF or .txt/.md file
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const docId = randomUUID();
    const docName = req.file.originalname;
    const isPdf = req.file.mimetype === 'application/pdf';
    const pages = isPdf
      ? await extractPages(req.file.buffer)
      : [{ page: 1, text: req.file.buffer.toString('utf8') }];

    const chunks = chunkPages(pages);
    if (!chunks.length) {
      return res.status(422).json({ error: 'No extractable text (scanned PDF?)' });
    }

    const vectors = await embedDocuments(chunks.map((c) => c.text));
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

    res.json({ docId, docName, pages: pages.length, chunks: chunks.length, failed: failed.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Remove a document and all its chunks
router.delete('/:docId', async (req, res) => {
  try {
    const out = await ts.collections(COLLECTION).documents()
      .delete({ filter_by: `docId:=\`${req.params.docId}\`` });
    invalidateKeywordIndex();
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
