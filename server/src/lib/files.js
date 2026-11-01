import { mkdir, readFile, writeFile, rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { GridFSBucket } from 'mongodb';
import { getDatabase } from './db.js';

// Original uploads, kept so the client can show the source page of a citation.
// MongoDB GridFS when configured (works on Atlas and on hosts with no persistent disk,
// like Render), otherwise a local uploads/ folder for development.
const UPLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads');

async function bucket() {
  const db = await getDatabase();
  return db ? new GridFSBucket(db, { bucketName: 'files' }) : null;
}

export async function saveFile(docId, buffer, { filename, contentType }) {
  const b = await bucket();
  if (b) {
    await new Promise((resolve, reject) => {
      b.openUploadStreamWithId(docId, filename, { metadata: { contentType } })
        .on('finish', resolve)
        .on('error', reject)
        .end(buffer);
    });
    return;
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, docId), buffer);
  await writeFile(path.join(UPLOAD_DIR, `${docId}.json`), JSON.stringify({ filename, contentType }));
}

// Returns { buffer, filename, contentType } or null if this document has no stored file
// (e.g. uploaded before files were kept)
export async function loadFile(docId) {
  const b = await bucket();
  if (b) {
    const [info] = await b.find({ _id: docId }).toArray();
    if (!info) return null;
    const chunks = [];
    for await (const chunk of b.openDownloadStream(docId)) chunks.push(chunk);
    return { buffer: Buffer.concat(chunks), filename: info.filename, contentType: info.metadata?.contentType };
  }
  try {
    const meta = JSON.parse(await readFile(path.join(UPLOAD_DIR, `${docId}.json`), 'utf8'));
    return { buffer: await readFile(path.join(UPLOAD_DIR, docId)), ...meta };
  } catch {
    return null;
  }
}

export async function deleteFile(docId) {
  const b = await bucket();
  if (b) {
    await b.delete(docId).catch(() => {}); // no stored file is fine
    return;
  }
  await rm(path.join(UPLOAD_DIR, docId), { force: true });
  await rm(path.join(UPLOAD_DIR, `${docId}.json`), { force: true });
}
