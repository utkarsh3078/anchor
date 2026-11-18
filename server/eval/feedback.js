// Turns rated answers into DRAFT test questions, so what visitors flag improves the test set.
//   node eval/feedback.js [--rating down|up|all] [--all-keys] [--out <file>]
// Default: thumbs-down answers asked with GEMINI_API_KEY from .env (your own key, so the
// documents are yours). --all-keys includes every visitor's ratings: those questions are
// about the visitors' own documents, which you don't have, so only keep the ones you can answer.
// Writes eval/datasets/drafts/feedback-<date>.json (not committed; it holds people's questions).
// Each question keeps what the system did (`review`) and starts with answerable: null and no
// reference answer. The runners refuse a draft: for each question set answerable, answer and
// gold pages (or delete it), add each document's file, remove "draft", then save it under
// eval/datasets/ and run it like any dataset.
import 'dotenv/config';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { collection, closeDb, mongoEnabled } from '../src/lib/db.js';
import { draftDataset } from './drafts.js';

const { values: args } = parseArgs({
  options: {
    rating: { type: 'string', default: 'down' },
    'all-keys': { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});

async function main() {
  if (!['down', 'up', 'all'].includes(args.rating)) throw new Error('--rating must be down, up or all');
  if (!mongoEnabled()) throw new Error('MONGODB_URI is not set: ratings live in MongoDB');
  const filter = { 'feedback.rating': args.rating === 'all' ? { $in: ['up', 'down'] } : args.rating };
  if (!args['all-keys']) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set in .env (or pass --all-keys)');
    filter.owner = createHash('sha256').update(process.env.GEMINI_API_KEY).digest('hex').slice(0, 16);
  }
  const col = await collection('messages');
  const messages = await col.find(filter, { projection: { _id: 0, owner: 0, attempts: 0 } }).sort({ 'feedback.at': 1 }).toArray();
  await closeDb();
  if (!messages.length) {
    console.log(`No ${args.rating === 'all' ? '' : `${args.rating} `}ratings${args['all-keys'] ? '' : ' for your key'} yet.`);
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  const dataset = draftDataset(messages, { name: `feedback-${date}` });
  const out = args.out ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'datasets', 'drafts', `${dataset.name}.json`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), out)}: ${dataset.questions.length} draft questions about ${dataset.docs.length} document(s).`);
  console.log('Next: fill in answerable / answer / gold for each question, add each document\'s file, remove "draft".');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
