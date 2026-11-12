import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { ts, ensureCollection } from './lib/typesense.js';
import { collection, mongoEnabled, pingDb, safeWrite } from './lib/db.js';
import { usage, mongoUsageStore } from './lib/usage.js';
import { sendError } from './routes/common.js';
import documents from './routes/documents.js';
import search from './routes/search.js';
import ask from './routes/ask.js';
import chats from './routes/chats.js';
import gemini from './routes/gemini.js';

const app = express();
if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy); // real client IP behind Render's proxy
app.use(cors(config.corsOrigins ? { origin: config.corsOrigins } : {}));
app.use(express.json({ limit: '5mb' })); // pasted documents can exceed the 100kb default

app.get('/api/health', async (_, res) => {
  const typesense = await ts.health.retrieve().then(() => 'ok', (e) => `error: ${e.message}`);
  const mongo = await pingDb();
  const ok = typesense === 'ok' && (mongo === 'ok' || mongo === 'disabled');
  res.status(ok ? 200 : 503).json({ ok, typesense, mongo, requireUserKey: config.requireUserKey });
});
app.use('/api/documents', documents);
app.use('/api/search', search);
app.use('/api/ask', ask);
app.use('/api/chats', chats);
app.use('/api/gemini', gemini);

// Errors raised outside route handlers (bad JSON body, upload over 25 MB) as JSON too
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') Object.assign(err, { status: 400, code: 'bad_request' });
  if (err.code === 'LIMIT_FILE_SIZE') Object.assign(err, { status: 413, code: 'file_too_large', message: 'Files are limited to 25 MB' });
  else if (err.name === 'MulterError') Object.assign(err, { status: 400, code: 'bad_request' }); // e.g. more than one file
  sendError(res, err);
});

try {
  await ensureCollection();
} catch (e) {
  const { host, port } = config.typesense;
  console.error(`Cannot reach Typesense at ${host}:${port} (${e.code ?? e.message}). Is Docker running? Try: docker start typesense`);
  process.exit(1);
}
if (mongoEnabled()) {
  console.log('MongoDB:', await pingDb());
  usage.attachStore(mongoUsageStore({ safeWrite, collection })); // daily usage counts survive restarts
}
if (!config.corsOrigins) console.warn('CORS_ORIGIN not set: allowing all origins (fine for local dev only)');
console.log(config.limits.enabled ? 'Rate limits: on' : 'Rate limits: off (RATE_LIMITS=true to turn on)');
if (!config.requireUserKey) console.warn('REQUIRE_USER_KEY is not true: requests without X-Gemini-Key use the server key');
app.listen(config.port, () => console.log(`Anchor server running on :${config.port}`));
