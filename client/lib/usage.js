// Turns GET /api/gemini/usage into the rows of the Usage panel. Pure, for `npm test`.

export function duration(sec) {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

// From this share of a limit the numbers are shown in red
export const WARN_AT = 0.8;

const meter = (used, limit) => {
  const fraction = limit ? Math.min(1, used / limit) : 0;
  return { used, limit, left: Math.max(0, limit - used), fraction, warn: fraction >= WARN_AT, over: used >= limit };
};

// summary.models -> [{ model, title, today, minute, tokens, limited }]
export function usageRows(summary) {
  if (!summary?.enabled) return [];
  return summary.models.map((m) => ({
    model: m.model,
    title: m.kind === 'embedding' ? 'Reading and searching documents' : m.model,
    subtitle: m.kind === 'embedding' ? m.model : 'answers and rewording',
    today: meter(m.today.requests, m.limits.requestsPerDay),
    minute: meter(m.minute.requests, m.limits.requestsPerMinute),
    tokens: m.limits.tokensPerMinute ? meter(m.minute.tokens, m.limits.tokensPerMinute) : null,
    limited: m.limited
      ? `Google refused a request: ${m.limited.scope === 'day' ? "today's limit" : 'the per-minute limit'} is reached. Try again in ${duration(m.limited.retryInSec)}.`
      : null,
  }));
}
