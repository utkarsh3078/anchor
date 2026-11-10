// Keeps embedding uploads inside a Gemini key's per-minute limits. The free tier for
// gemini-embedding-001 allows 100 requests and 30,000 tokens per minute (figures from the
// project owner's AI Studio page, Nov 2026); a document of more than ~100 chunks sent in
// back-to-back batches goes over both.

// Rough token count: about 4 characters per token for English text. An estimate, not a
// measurement, so the token budget is used with a safety margin (see embed.js) and a 429
// is still handled by waiting.
export const estimateTokens = (text) => Math.ceil(text.length / 4);

// Consecutive texts packed into batches of at most maxTexts texts and maxTokens estimated
// tokens. A single text over maxTokens goes alone. Returns [{ start, end, tokens }].
export function planBatches(texts, { maxTexts, maxTokens }) {
  const batches = [];
  let current = null;
  texts.forEach((text, i) => {
    const tokens = estimateTokens(text);
    if (current && (current.end - current.start >= maxTexts || current.tokens + tokens > maxTokens)) {
      batches.push(current);
      current = null;
    }
    current ??= { start: i, end: i, tokens: 0 };
    current.end = i + 1;
    current.tokens += tokens;
  });
  if (current) batches.push(current);
  return batches;
}

// What one key has sent in the last `windowMs`. Every text is counted as one request:
// whether Google counts a 100-text batch as 1 request or 100 isn't documented, and
// counting each text is safe either way.
export class MinuteBudget {
  constructor({ maxRequests, maxTokens, windowMs = 60_000, now = Date.now }) {
    Object.assign(this, { maxRequests, maxTokens, windowMs, now });
    this.events = []; // { at, requests, tokens }, oldest first
  }

  prune() {
    const cutoff = this.now() - this.windowMs;
    while (this.events.length && this.events[0].at <= cutoff) this.events.shift();
  }

  // Milliseconds until `requests` texts with `tokens` tokens fit in the window (0 = now).
  // Something larger than the whole budget is let through once the window is empty.
  waitFor(requests, tokens) {
    this.prune();
    let usedRequests = this.events.reduce((a, e) => a + e.requests, 0);
    let usedTokens = this.events.reduce((a, e) => a + e.tokens, 0);
    const fits = () => usedRequests + requests <= this.maxRequests && usedTokens + tokens <= this.maxTokens;
    const untilGone = (e) => Math.max(0, e.at + this.windowMs - this.now());
    if (fits()) return 0;
    // It fits once enough of the oldest entries have left the window
    for (const e of this.events) {
      usedRequests -= e.requests;
      usedTokens -= e.tokens;
      if (fits()) return untilGone(e);
    }
    return this.events.length ? untilGone(this.events.at(-1)) : 0;
  }

  // Returns the entry so a refused request can be taken back out with forget()
  record(requests, tokens) {
    const event = { at: this.now(), requests, tokens };
    this.events.push(event);
    return event;
  }

  forget(event) {
    this.events = this.events.filter((e) => e !== event);
  }
}
