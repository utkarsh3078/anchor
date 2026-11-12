import { config } from '../config.js';
import { LruCache } from './cache.js';

// Guardrails for a public deployment. Visitors spend their own Gemini quota, but every
// question also spends the SERVER's Cohere calls, Typesense and MongoDB, and CORS does not
// stop anyone calling the API directly. So each costly route is limited per Gemini key
// (hashed) and per IP, and Cohere has a server-wide daily budget.
// Counts are in memory: one server instance (as the BM25 index already requires), and a
// restart starts them again from zero.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Fixed one-minute and one-day windows per id. check() looks without counting, so a
// request refused by one rule does not use up another rule's allowance.
export class WindowCounter {
  constructor({ perMinute = Infinity, perDay = Infinity, now = Date.now, max = 10_000 } = {}) {
    Object.assign(this, { perMinute, perDay, now });
    this.ids = new LruCache(max);
  }

  #entry(id) {
    const t = this.now();
    const e = this.ids.get(id) ?? { minute: t, inMinute: 0, day: t, inDay: 0 };
    if (t - e.minute >= MINUTE) Object.assign(e, { minute: t, inMinute: 0 });
    if (t - e.day >= DAY) Object.assign(e, { day: t, inDay: 0 });
    this.ids.set(id, e);
    return { e, t };
  }

  // { ok: true } or { ok: false, scope: 'minute' | 'day', retryAfterSec }
  check(id) {
    const { e, t } = this.#entry(id);
    if (e.inDay >= this.perDay) return { ok: false, scope: 'day', retryAfterSec: Math.ceil((e.day + DAY - t) / 1000) };
    if (e.inMinute >= this.perMinute) return { ok: false, scope: 'minute', retryAfterSec: Math.ceil((e.minute + MINUTE - t) / 1000) };
    return { ok: true };
  }

  take(id) {
    const { e } = this.#entry(id);
    e.inMinute++;
    e.inDay++;
  }
}

export const limitError = (code, message, extra = {}) => Object.assign(new Error(message), { status: 429, code, ...extra });

const WHAT = {
  questions: 'questions',
  uploads: 'uploads',
  keys: 'key checks',
  reads: 'requests',
};

// Express middleware. Run it after withGemini/withOwner so the key's hash is known.
// rules: { key: { perMinute, perDay }, ip: { perMinute, perDay } } (either may be left out)
export function rateLimit(name, rules, { enabled = () => config.limits.enabled, now } = {}) {
  const counters = Object.entries(rules).map(([by, r]) => ({ by, counter: new WindowCounter({ ...r, now }) }));
  return (req, res, next) => {
    if (!enabled()) return next();
    const ids = counters.map(({ by, counter }) => ({ counter, id: by === 'key' ? req.gemini?.keyHash : req.ip }))
      .filter((c) => c.id);
    for (const { counter, id } of ids) {
      const v = counter.check(id);
      if (!v.ok) {
        res.set('Retry-After', String(v.retryAfterSec));
        return res.status(429).json({
          error: 'rate_limited',
          scope: v.scope,
          retryAfterSec: v.retryAfterSec,
          message: v.scope === 'day'
            ? `Too many ${WHAT[name] ?? 'requests'} today. Try again tomorrow.`
            : `Too many ${WHAT[name] ?? 'requests'} in a minute. Wait ${v.retryAfterSec} s and try again.`,
        });
      }
    }
    for (const { counter, id } of ids) counter.take(id);
    next();
  };
}

// Server-wide Cohere budget: a Cohere trial key allows about 1,000 calls a month, and any
// visitor's questions spend them. null = no budget (limits off).
let cohereCounter = null;
export function takeCohereCall({ enabled = config.limits.enabled, perDay = config.limits.cohereDaily, now } = {}) {
  if (!enabled || !perDay) return;
  if (!cohereCounter || cohereCounter.perDay !== perDay) cohereCounter = new WindowCounter({ perDay, now });
  if (!cohereCounter.check('server').ok) {
    throw Object.assign(new Error("Anchor's search has reached its daily limit. Try again tomorrow."), { status: 503, code: 'cohere_budget' });
  }
  cohereCounter.take('server');
}

// Cohere's per-minute limit (10 calls a minute on a trial key) is shared by every visitor,
// so calls are spaced server-wide: each takes the next free slot in a rolling minute and
// waits for it, instead of being sent and refused with a 429. A slot further away than
// maxWaitMs is refused at once (cohere_quota), so a queue can't hold a request for minutes.
// Slots are reserved before waiting, so concurrent requests can't take the same one.
// Always on (also locally); COHERE_RPM=0 turns it off.
export class MinutePacer {
  constructor({ perMinute, maxWaitMs = 30_000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    Object.assign(this, { perMinute, maxWaitMs, now, sleep });
    this.slots = []; // send times, ascending
  }

  // ms until the next free slot, without taking it
  #nextSlot(t) {
    this.slots = this.slots.filter((s) => s > t - MINUTE);
    if (this.slots.length < this.perMinute) return t;
    return Math.max(t, this.slots[this.slots.length - this.perMinute] + MINUTE);
  }

  async wait() {
    if (!this.perMinute) return 0;
    const t = this.now();
    const slot = this.#nextSlot(t);
    if (slot - t > this.maxWaitMs) {
      throw Object.assign(new Error('Anchor is busy right now. Wait a minute and try again.'), {
        status: 429, code: 'cohere_quota', retryAfterSec: Math.ceil((slot - t) / 1000),
      });
    }
    this.slots.push(slot);
    this.slots.sort((a, b) => a - b);
    if (slot > t) await this.sleep(slot - t);
    return slot - t;
  }
}

export const cohereMinute = new MinutePacer({ perMinute: config.limits.cohereRpm });

// One upload at a time per key: an upload can wait minutes for the embedding limits,
// and each holds its file (up to 25 MB) in memory.
const uploading = new Set();
export async function oneUploadAtATime(keyHash, fn) {
  if (!keyHash) return fn();
  if (uploading.has(keyHash)) {
    throw limitError('upload_in_progress', 'Another upload with this key is still running. Wait for it to finish.');
  }
  uploading.add(keyHash);
  try {
    return await fn();
  } finally {
    uploading.delete(keyHash);
  }
}

// Ready-made limiters for the routes (numbers from config, read once at start)
const L = config.limits;
export const limitQuestions = rateLimit('questions', {
  key: { perMinute: L.questionsPerMinute, perDay: L.questionsPerDay },
  ip: { perMinute: L.questionsPerMinute * 3, perDay: L.questionsPerDay * 3 },
});
export const limitUploads = rateLimit('uploads', {
  key: { perMinute: 3, perDay: L.uploadsPerDay },
  ip: { perMinute: 6, perDay: L.uploadsPerDay * 3 },
});
export const limitKeyChecks = rateLimit('keys', { ip: { perMinute: 20, perDay: 500 } });
export const limitReads = rateLimit('reads', { ip: { perMinute: 120, perDay: 5000 } });
