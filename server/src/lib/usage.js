import { config } from '../config.js';
import { MinuteBudget } from './pace.js';

// What each Gemini key has used THROUGH THIS SERVER, so the client can show "used" next
// to the key's limits. It is an estimate of the key's real quota state: Google exposes no
// way to read a key's limits or remaining quota, usage of the same key elsewhere is
// invisible here, and the limits are configured defaults (free tier), not read from Google.
// Keys are identified by the short hash already used for chat history, never by the key.
// Daily counts follow Google's quota day (midnight Pacific) and are kept in MongoDB when
// a store is attached (src/index.js does that), so they survive a restart; the last
// minute's counts and the "limit reached" notes live in memory only.

const PACIFIC = 'America/Los_Angeles';

// Google's quota day for a moment in time, e.g. '2026-11-10'
export function quotaDay(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PACIFIC }).format(new Date(now));
}

// Seconds until that day ends (off by an hour on the two daylight-saving change days)
export function secondsToReset(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: PACIFIC, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(now));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return 86400 - ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second'));
}

const isEmbedding = (model) => model === config.gemini.embedModel;

// The limits shown for a model. Embedding: the pacing limits plus the daily one. Text
// models: one default for all of them (GEMINI_TEXT_RPM / GEMINI_TEXT_RPD), because each
// model and tier has its own and none can be looked up.
export function limitsFor(model, limits = config.gemini) {
  return isEmbedding(model)
    ? { requestsPerMinute: limits.embedRpm, tokensPerMinute: limits.embedTpm, requestsPerDay: limits.embedRpd }
    : { requestsPerMinute: limits.textRpm, tokensPerMinute: null, requestsPerDay: limits.textRpd };
}

export function createUsage({ now = Date.now, enabled = () => config.usageTracking } = {}) {
  const days = new Map(); // `${keyHash}|${model}|${day}` -> { requests, tokens }
  const minutes = new Map(); // `${keyHash}|${model}` -> MinuteBudget (used as a rolling counter)
  const limited = new Map(); // `${keyHash}|${model}` -> { scope, until }
  let store = null;

  const minuteOf = (id) => {
    if (!minutes.has(id)) minutes.set(id, new MinuteBudget({ maxRequests: Infinity, maxTokens: Infinity, now }));
    return minutes.get(id);
  };

  return {
    // store: { add(keyHash, model, day, requests, tokens), read(keyHash, day) -> [{ model, requests, tokens }] | null }
    attachStore(s) { store = s; },

    // One successful Gemini call. requests: texts embedded, or 1 for a text request.
    record(gemini, model, { requests = 1, tokens = 0 } = {}) {
      if (!enabled() || !gemini?.keyHash) return;
      const day = quotaDay(now());
      const id = `${gemini.keyHash}|${model}|${day}`;
      const d = days.get(id) ?? { requests: 0, tokens: 0 };
      d.requests += requests;
      d.tokens += tokens;
      days.set(id, d);
      minuteOf(`${gemini.keyHash}|${model}`).record(requests, tokens);
      // Yesterday's entries are of no further use
      if (days.size > 5000) for (const k of days.keys()) if (!k.endsWith(`|${day}`)) days.delete(k);
      store?.add(gemini.keyHash, model, day, requests, tokens);
    },

    // Google refused a request: the one real signal about the key's quota
    noteLimit(gemini, { model, scope, retryAfterSec } = {}) {
      if (!enabled() || !gemini?.keyHash || !model) return;
      const until = scope === 'day' ? now() + secondsToReset(now()) * 1000 : now() + (retryAfterSec ?? 60) * 1000;
      limited.set(`${gemini.keyHash}|${model}`, { scope, until });
    },

    // The embedding model, the caller's answer model, and every model used today
    async summary(gemini) {
      if (!enabled()) return { enabled: false };
      const day = quotaDay(now());
      const used = new Map(); // model -> { requests, tokens } today
      const prefix = `${gemini.keyHash}|`;
      for (const [id, d] of days) {
        if (id.startsWith(prefix) && id.endsWith(`|${day}`)) used.set(id.slice(prefix.length, -day.length - 1), { ...d });
      }
      // The store has everything since the day began, memory only since this process
      // started (and a write still on its way is in memory first): take the larger
      const stored = store ? await store.read(gemini.keyHash, day) : null; // null = no store, or unreachable
      for (const s of stored ?? []) {
        const m = used.get(s.model) ?? { requests: 0, tokens: 0 };
        used.set(s.model, { requests: Math.max(m.requests, s.requests), tokens: Math.max(m.tokens, s.tokens) });
      }

      const names = [...new Set([config.gemini.embedModel, gemini.model, ...used.keys()])];
      return {
        enabled: true,
        estimate: true,
        day,
        resetsInSec: secondsToReset(now()),
        persisted: stored !== null,
        models: names.map((model) => {
          const minute = minuteOf(`${gemini.keyHash}|${model}`);
          minute.prune();
          const note = limited.get(`${gemini.keyHash}|${model}`);
          return {
            model,
            kind: isEmbedding(model) ? 'embedding' : 'text',
            limits: limitsFor(model),
            minute: { requests: minute.events.reduce((a, e) => a + e.requests, 0), tokens: minute.events.reduce((a, e) => a + e.tokens, 0) },
            today: used.get(model) ?? { requests: 0, tokens: 0 },
            limited: note && note.until > now() ? { scope: note.scope, retryInSec: Math.ceil((note.until - now()) / 1000) } : null,
          };
        }),
      };
    },
  };
}

// The server's one tracker
export const usage = createUsage();

// Daily counts in MongoDB: one document per key hash, model and quota day
export function mongoUsageStore({ safeWrite, collection }) {
  return {
    add(keyHash, model, day, requests, tokens) {
      // Not awaited: counting must never slow down or fail the request it counts
      safeWrite('usage', (col) => col.updateOne(
        { _id: `${keyHash}|${model}|${day}` },
        { $inc: { requests, tokens }, $set: { owner: keyHash, model, day, updatedAt: new Date() } },
        { upsert: true },
      ));
    },
    async read(keyHash, day) {
      try {
        const col = await collection('usage');
        if (!col) return null;
        return await col.find({ owner: keyHash, day }, { projection: { _id: 0, model: 1, requests: 1, tokens: 1 } }).toArray();
      } catch {
        return null;
      }
    },
  };
}
