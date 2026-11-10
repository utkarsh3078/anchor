import 'dotenv/config';
import { fileURLToPath } from 'url';

const fraction = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== '' && n >= 0 && n <= 1 ? n : fallback;
};

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
  // How the keyword and vector lists are merged (lib/fusion.js): 'rrf' (weighted
  // reciprocal rank fusion, the default and the earlier behaviour) or 'convex' (min-max
  // normalised scores, alpha * vector + (1 - alpha) * BM25). A request can override both.
  // alpha 0.5 is a placeholder until eval/alpha-search.js has been run on the tuning split.
  fusion: {
    method: process.env.FUSION === 'convex' ? 'convex' : 'rrf',
    alpha: fraction(process.env.FUSION_ALPHA, 0.5),
  },
  // Evidence gate (lib/gate.js). Off by default: the fixed threshold decides, as before.
  // On, it needs the coefficients file (eval/fit-gate.js writes it); without the file
  // the threshold still decides. The cut-offs are provisional until tuned on the real
  // dataset. A request can override all of these (gate, gateLow, gateHigh, sufficiencyCheck).
  gate: {
    enabled: process.env.EVIDENCE_GATE === 'true',
    file: process.env.GATE_COEFFICIENTS || fileURLToPath(new URL('../data/gate-coefficients.json', import.meta.url)),
    low: fraction(process.env.GATE_LOW, 0.3),
    high: fraction(process.env.GATE_HIGH, 0.7),
    sufficiency: process.env.GATE_SUFFICIENCY !== 'false',
  },
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
