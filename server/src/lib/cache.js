// Small in-memory LRU cache. Used to avoid repeating identical Gemini calls
// (free-tier quotas count requests), so it lives per server process.
export class LruCache {
  constructor(max = 500) {
    this.max = max;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key); // re-insert to mark as most recently used
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return value;
  }
}

// Returns the cached value for key, or runs fn and caches its result
export async function cached(cache, key, enabled, fn) {
  if (enabled) {
    const hit = cache.get(key);
    if (hit !== undefined) return { value: hit, cached: true };
  }
  const value = await fn();
  cache.set(key, value);
  return { value, cached: false };
}
