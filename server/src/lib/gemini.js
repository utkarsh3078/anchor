import { createHash } from 'crypto';
import { GoogleGenAI, ApiError } from '@google/genai';
import { config } from '../config.js';
import { LruCache } from './cache.js';

// Users bring their own Gemini key (X-Gemini-Key header). Keys are only held in
// memory for the lifetime of a cached client and are never logged or stored.
const clients = new LruCache(100);
const MODEL_NAME = /^[a-z0-9][a-z0-9.-]{1,62}$/i;

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

export function geminiClient(apiKey) {
  return clients.get(apiKey) ?? clients.set(apiKey, new GoogleGenAI({
    apiKey,
    // Retry transient failures only. 429 (quota) is not retried: a per-minute limit
    // needs ~30-60 s and a daily one won't clear today, so retrying just burns requests.
    httpOptions: { retryOptions: { attempts: 3, initialDelay: 1, maxDelay: 8, httpStatusCodes: [408, 500, 502, 503, 504] } },
  }));
}

function pickModel(value, fallback) {
  const name = (value ?? '').trim().replace(/^models\//, '');
  if (!name) return fallback;
  if (!MODEL_NAME.test(name)) throw httpError(400, 'bad_request', `invalid model name: ${name}`);
  return name;
}

// Per-request Gemini settings from headers:
//   X-Gemini-Key           the user's key (required when REQUIRE_USER_KEY=true)
//   X-Gemini-Model         model for answers (default GEMINI_MODEL)
//   X-Gemini-Rewrite-Model model for query rewriting (default: the answer model). A
//                          different model draws on a separate free-tier quota.
//   X-Anchor-No-Cache: 1   bypass caches (the eval runner uses this for honest latency)
export function geminiContext(headers, {
  serverKey = config.gemini.apiKey, requireUserKey = config.requireUserKey, defaultModel = config.gemini.genModel,
} = {}) {
  const userKey = headers['x-gemini-key']?.trim();
  const apiKey = userKey || (requireUserKey ? null : serverKey);
  if (!apiKey) throw httpError(401, 'gemini_key_required', 'Send your Gemini API key in the X-Gemini-Key header');
  const model = pickModel(headers['x-gemini-model'], defaultModel);
  return {
    ai: geminiClient(apiKey),
    keyHash: createHash('sha256').update(apiKey).digest('hex').slice(0, 16),
    model,
    rewriteModel: pickModel(headers['x-gemini-rewrite-model'], model),
    useCache: headers['x-anchor-no-cache'] !== '1',
  };
}

// Text models this key can use, for the model picker. This is a metadata call, not a
// generation request. Cached per key for 10 minutes.
const modelLists = new LruCache(200);
// Models that list generateContent but aren't for document Q&A (seen in a real model list)
const NON_TEXT = /embedding|tts|image|imagen|audio|live|veo|aqa|banana|robotics|computer-use|transcribe|customtools/i;

export async function listTextModels(gemini) {
  const hit = modelLists.get(gemini.keyHash);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.models;
  const models = [];
  for await (const m of await gemini.ai.models.list({ config: { pageSize: 100 } })) {
    const id = m.name?.replace(/^models\//, '');
    if (!id?.startsWith('gemini') || NON_TEXT.test(id)) continue;
    if (m.supportedActions && !m.supportedActions.includes('generateContent')) continue;
    models.push({ id, displayName: m.displayName ?? id, inputTokenLimit: m.inputTokenLimit ?? null });
  }
  models.sort((a, b) => b.id.localeCompare(a.id));
  modelLists.set(gemini.keyHash, { at: Date.now(), models });
  return models;
}

// Turns a Gemini ApiError into an HTTP status + body the client can act on
// (e.g. offer a model switch on gemini_quota). Returns null for other errors.
export function geminiHttpError(e) {
  if (!(e instanceof ApiError) && e?.name !== 'ApiError') return null;
  const msg = String(e.message ?? '');
  const model = msg.match(/model\\?"\s*:\s*\\?"([^"\\]+)/)?.[1] ?? null;

  if (e.status === 429) {
    const scope = /PerDay/i.test(msg) ? 'day' : 'minute';
    const retryAfterSec = Number(msg.match(/retryDelay\\?"\s*:\s*\\?"(\d+)s/)?.[1]) || null;
    return {
      status: 429,
      body: {
        error: 'gemini_quota', scope, model, retryAfterSec,
        message: scope === 'day'
          ? `Gemini daily quota${model ? ` for ${model}` : ''} is used up. Switch to another model or try again tomorrow.`
          : `Gemini per-minute limit${model ? ` for ${model}` : ''} reached. Wait a minute or switch model.`,
      },
    };
  }
  if (e.status === 401 || e.status === 403 || /API key not valid|API_KEY_INVALID/i.test(msg)) {
    return { status: 401, body: { error: 'gemini_key_invalid', message: 'The Gemini API key was rejected.' } };
  }
  if (e.status === 404) {
    return { status: 400, body: { error: 'gemini_model_unavailable', message: 'That model is not available for this key. Pick another.' } };
  }
  if (e.status >= 500) {
    return { status: 503, body: { error: 'gemini_unavailable', message: 'Gemini is temporarily unavailable. Try again shortly.' } };
  }
  return { status: 502, body: { error: 'gemini_error', message: msg.slice(0, 300) } };
}
