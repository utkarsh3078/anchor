// Retrieval settings under "Advanced". The defaults mirror the server's /api/ask defaults
// (mode anchor, strict false, routes/common.js DEFAULT_THRESHOLD and DEFAULT_MAX_RETRIES;
// k 10 is the client's choice, the server's is 5). Only values the visitor changed are
// sent, so the server's defaults, and later backend changes to them, apply otherwise.
export const DEFAULTS = Object.freeze({ mode: 'anchor', k: 10, threshold: 0.15, maxRetries: 1, strict: false });

export const MODES = [
  { id: 'anchor', label: 'Anchor (recommended)' },
  { id: 'hybrid', label: 'Hybrid baseline' },
  { id: 'dense', label: 'Dense baseline' },
];

const ANCHOR_ONLY = ['threshold', 'maxRetries', 'strict'];

const VALID = {
  mode: (v) => MODES.some((m) => m.id === v),
  k: (v) => Number.isInteger(v) && v >= 3 && v <= 15,
  threshold: (v) => typeof v === 'number' && v >= 0 && v <= 1,
  maxRetries: (v) => Number.isInteger(v) && v >= 0 && v <= 3,
  strict: (v) => typeof v === 'boolean',
};

export const isDefault = (settings) => Object.keys(DEFAULTS).every((f) => settings[f] === DEFAULTS[f]);

// The /api/ask body for these settings
export function askBody({ query, docIds, chatId, settings = DEFAULTS }) {
  const body = { query, k: settings.k, docIds };
  if (chatId) body.chatId = chatId;
  if (settings.mode !== DEFAULTS.mode) body.mode = settings.mode;
  if (settings.mode === 'anchor') {
    for (const f of ANCHOR_ONLY) if (settings[f] !== DEFAULTS[f]) body[f] = settings[f];
  }
  return body;
}

// Remembered per browser (a convenience, not state anyone relies on). Anything missing
// or invalid falls back to the defaults; storage that throws (private mode) is ignored.
const PREFS_KEY = 'anchor.advanced';

export function loadPrefs(storage = globalThis.localStorage) {
  const prefs = { settings: { ...DEFAULTS }, showDetails: false };
  try {
    const saved = JSON.parse(storage?.getItem(PREFS_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return prefs;
    for (const [f, valid] of Object.entries(VALID)) {
      if (valid(saved.settings?.[f])) prefs.settings[f] = saved.settings[f];
    }
    prefs.showDetails = saved.showDetails === true;
  } catch { /* unreadable: defaults */ }
  return prefs;
}

export function savePrefs(prefs, storage = globalThis.localStorage) {
  try { storage?.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* not saved */ }
}
