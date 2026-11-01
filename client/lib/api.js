export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// The visitor's Gemini key lives only in this tab (sessionStorage is cleared when the tab
// closes) and is sent to the Anchor server in a header on each request.
const KEY_STORAGE = 'anchor.geminiKey';

export const keyStore = {
  get() {
    try { return sessionStorage.getItem(KEY_STORAGE); } catch { return null; }
  },
  set(key) {
    try { sessionStorage.setItem(KEY_STORAGE, key); } catch { /* private mode: key stays in memory only */ }
  },
  clear() {
    try { sessionStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
  },
};

// Server errors are { error: code, message }; code drives the UI (e.g. gemini_quota)
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || body?.error || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error;
    this.body = body ?? {};
  }
}

// gemini: { key, model, rewriteModel } -> X-Gemini-* headers
export async function api(path, { method = 'GET', json, form, gemini = {} } = {}) {
  const headers = {};
  if (gemini.key) headers['X-Gemini-Key'] = gemini.key;
  if (gemini.model) headers['X-Gemini-Model'] = gemini.model;
  if (gemini.rewriteModel) headers['X-Gemini-Rewrite-Model'] = gemini.rewriteModel;
  if (json) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(API_URL + path, { method, headers, body: form ?? (json && JSON.stringify(json)) });
  } catch {
    throw new ApiError(0, { error: 'network', message: `Cannot reach the Anchor server at ${API_URL}` });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}
