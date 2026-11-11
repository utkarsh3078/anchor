'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { duration, usageRows } from '@/lib/usage';

function Meter({ label, m, unit = '' }) {
  return (
    <div>
      <div className="flex justify-between gap-2 text-sm text-muted">
        <span className={m.warn ? 'font-semibold text-danger-fg' : ''}>{label}</span>
        <span className={`text-right tabular-nums ${m.warn ? 'font-semibold text-danger-fg' : ''}`}>
          {m.used.toLocaleString()} of {m.limit.toLocaleString()}{unit} · {m.left.toLocaleString()} left
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-surface-2">
        <div className={`h-2 rounded-full ${m.warn ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${m.fraction * 100}%` }} />
      </div>
    </div>
  );
}

// What this key has used through Anchor, next to its limits. An estimate: Google has no
// way to ask for a key's real remaining quota. refreshKey changes after every question
// and upload, so the numbers follow what the visitor does.
export default function Usage({ gemini, refreshKey }) {
  const [summary, setSummary] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('/api/gemini/usage', { gemini })
      .then((s) => { if (!cancelled) { setSummary(s); setFailed(false); } })
      .catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, gemini.key, gemini.model]);

  if (failed && !summary) return <p className="text-sm text-muted">Usage isn&apos;t available right now.</p>;
  if (!summary) return <p className="text-sm text-muted">Loading usage…</p>;
  if (!summary.enabled) return <p className="text-sm text-muted">Usage counting is turned off on this server.</p>;

  const rows = usageRows(summary);
  const warn = rows.some((r) => r.today.warn || r.minute.warn || r.tokens?.warn);
  return (
    <div className="space-y-6">
      {warn && <p className="text-sm font-semibold text-danger-fg">Close to a limit (80% or more used).</p>}
      {rows.map((row) => (
        <div key={row.model} className="space-y-3">
          <p className="font-semibold">
            {row.title} <span className="text-sm font-normal text-muted">({row.subtitle})</span>
          </p>
          <Meter label="Requests today" m={row.today} />
          <Meter label="Requests this minute" m={row.minute} />
          {row.tokens && <Meter label="Tokens this minute (estimated)" m={row.tokens} />}
          {row.limited && <p className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-fg">{row.limited}</p>}
        </div>
      ))}
      <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted">
        Today&apos;s counts reset in {duration(summary.resetsInSec)}. This is an estimate: it counts only what this
        key did through Anchor{summary.persisted ? '' : ' since the server last started'}, and the limits are the
        free-tier defaults, not read from Google. Your real figures are in{' '}
        <a className="underline" href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer">Google AI Studio</a>.
      </p>
    </div>
  );
}
