import 'dotenv/config';

export const config = {
  port: process.env.PORT || 4000,
  // Comma-separated allowed origins, e.g. the Vercel domain. Unset = allow all (dev only).
  corsOrigins: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : null,
  // Production: true, so every Gemini call uses the visitor's own key (X-Gemini-Key).
  // Locally it can stay false and fall back to GEMINI_API_KEY.
  requireUserKey: process.env.REQUIRE_USER_KEY === 'true',
  // Compute and log per-attempt confidence signals (lib/signals.js). false = the
  // behaviour before they existed: nothing extra computed, returned or stored.
  confidenceSignals: process.env.CONFIDENCE_SIGNALS !== 'false',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY, // optional server key (dev, eval judge)
    embedModel: 'gemini-embedding-001',
    // Uploads stay inside these per-minute limits of the embedding model and wait out a
    // per-minute 429 instead of failing (lib/embed.js). Defaults are the free tier's.
    // EMBED_PACING=false = the earlier behaviour: batches back to back, a 429 fails the upload.
    embedPacing: process.env.EMBED_PACING !== 'false',
    embedRpm: Number(process.env.GEMINI_EMBED_RPM) || 100,
    embedTpm: Number(process.env.GEMINI_EMBED_TPM) || 30000,
    genModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    dim: 768, // must match num_dim in the Typesense schema
  },
  cohere: {
    apiKey: process.env.COHERE_API_KEY,
    rerankModel: process.env.COHERE_RERANK_MODEL || 'rerank-v3.5',
  },
  typesense: {
    host: process.env.TYPESENSE_HOST,
    port: Number(process.env.TYPESENSE_PORT),
    protocol: process.env.TYPESENSE_PROTOCOL,
    apiKey: process.env.TYPESENSE_API_KEY,
  },
  mongo: {
    uri: process.env.MONGODB_URI,
    dbName: process.env.MONGODB_DB || 'anchor',
  },
};
