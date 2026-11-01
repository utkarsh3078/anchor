import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { ensureCollection } from './lib/typesense.js';
import documents from './routes/documents.js';
import search from './routes/search.js';
import ask from './routes/ask.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.use('/api/documents', documents);
app.use('/api/search', search);
app.use('/api/ask', ask);

await ensureCollection();
app.listen(config.port, () => console.log(`Anchor server running on :${config.port}`));
