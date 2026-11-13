// Turns GET /api/gemini/usage into the rows of the Usage panel. Pure, for `npm test`.

export function duration(sec) {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

// From this share of a limit the numbers are shown in red and the chat shows a warning
export const WARN_AT = 0.75;

const EMBED_TITLE = 'Reading and searching documents';

const meter = (used, limit) => {
  const fraction = limit ? Math.min(1, used / limit) : 0;
  return { used, limit, left: Math.max(0, limit - used), fraction, warn: fraction >= WARN_AT, over: used >= limit };
};

// summary.models -> [{ model, title, today, minute, tokens, limitedScope, limited }]
export function usageRows(summary) {
  if (!summary?.enabled) return [];
  return summary.models.map((m) => ({
    model: m.model,
    title: m.kind === 'embedding' ? EMBED_TITLE : m.model,
    subtitle: m.kind === 'embedding' ? m.model : 'answers and rewording',
    today: meter(m.today.requests, m.limits.requestsPerDay),
    minute: meter(m.minute.requests, m.limits.requestsPerMinute),
    tokens: m.limits.tokensPerMinute ? meter(m.minute.tokens, m.limits.tokensPerMinute) : null,
    limitedScope: m.limited?.scope ?? null, // 'minute' | 'day' | null
    limited: m.limited
      ? `Google refused a request: ${m.limited.scope === 'day' ? "today's limit" : 'the per-minute limit'} is reached. Try again in ${duration(m.limited.retryInSec)}.`
      : null,
  }));
}

// The banner above the question box: the most-used limit that matters for the next
// question (the embedding model and the answer model), once it reaches WARN_AT.
// null = nothing to say. id changes when the message would, so a dismissed banner
// comes back when things get worse.
export function usageAlert(summary, currentModel) {
  let worst = null;
  for (const row of usageRows(summary)) {
    const embedding = row.title === EMBED_TITLE;
    if (!embedding && row.model !== currentModel) continue;
    const meters = [['day', row.today], ['minute', row.minute], ['minute', row.tokens]];
    const candidates = meters.filter(([, m]) => m?.warn).map(([scope, m]) => ({ scope, m, level: m.over ? 'danger' : 'warn' }));
    // Google already refused a request: that is the limit to talk about, whatever our counts say
    if (row.limitedScope) candidates.push({ scope: row.limitedScope, m: row.limitedScope === 'day' ? row.today : row.minute, level: 'danger' });
    for (const c of candidates) {
      const rank = (c.level === 'danger' ? 2 : 0) + (c.scope === 'day' ? 1 : 0) + c.m.fraction;
      if (!worst || rank > worst.rank) worst = { ...c, rank, row, embedding };
    }
  }
  if (!worst) return null;

  const { level, scope, m, row, embedding } = worst;
  const what = embedding ? 'reading and searching documents' : row.model;
  const pct = Math.round(m.fraction * 100);
  let text;
  if (scope === 'day') {
    text = level === 'danger'
      ? `Your Gemini key has reached today's limit for ${what}.`
      : `Your Gemini key has used ${pct}% of today's limit for ${what} (${m.used.toLocaleString()} of ${m.limit.toLocaleString()}).`;
    text += ` It resets in ${duration(summary.resetsInSec)}.`;
    if (!embedding) text += ' You can switch to another model below.';
  } else {
    text = level === 'danger'
      ? `Your Gemini key has reached its per-minute limit for ${what}. Wait a minute before asking again.`
      : `Your Gemini key is close to its per-minute limit for ${what}. Leave a little time between questions.`;
  }
  return { id: `${row.model}|${scope}|${level}`, level, scope, text };
}
