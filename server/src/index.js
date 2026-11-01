import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { ts, ensureCollection } from './lib/typesense.js';
import { mongoEnabled, pingDb } from './lib/db.js';
import documents from './routes/documents.js';
import search from './routes/search.js';
import ask from './routes/ask.js';
import chats from './routes/chats.js';

const app = express();
app.use(cors(config.corsOrigins ? { origin: config.corsOrigins } : {}));
app.use(express.json({ limit: '5mb' })); // pasted documents can exceed the 100kb default

app.get('/api/health', async (_, res) => {
  const typesense = await ts.health.retrieve().then(() => 'ok', (e) => `error: ${e.message}`);
  const mongo = await pingDb();
  const ok = typesense === 'ok' && (mongo === 'ok' || mongo === 'disabled');
  res.status(ok ? 200 : 503).json({ ok, typesense, mongo });
});
app.use('/api/documents', documents);
app.use('/api/search', search);
app.use('/api/ask', ask);
app.use('/api/chats', chats);

await ensureCollection();
if (mongoEnabled()) console.log('MongoDB:', await pingDb());
if (!config.corsOrigins) console.warn('CORS_ORIGIN not set: allowing all origins (fine for local dev only)');
app.listen(config.port, () => console.log(`Anchor server running on :${config.port}`));
