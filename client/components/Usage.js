'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { duration, usageRows } from '@/lib/usage';

function Meter({ label, m, unit = '' }) {
  return (
    <div>
      <div className="flex justify-between gap-2 text-xs text-slate-600">
        <span className={m.warn ? 'font-semibold text-red-700' : ''}>{label}</span>
        <span className={m.warn ? 'font-semibold text-red-700' : ''}>
          {m.used.toLocaleString()} of {m.limit.toLocaleString()}{unit} · {m.left.toLocaleString()} left
        </span>
      </div>
      <div className="mt-0.5 h-1.5 rounded bg-slate-200">
        <div className={`h-1.5 rounded ${m.warn ? 'bg-red-500' : 'bg-slate-600'}`} style={{ width: `${m.fraction * 100}%` }} />
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

  if (failed && !summary) return <p className="text-xs text-slate-500">Usage isn&apos;t available right now.</p>;
  if (!summary) return <p className="text-xs text-slate-500">Loading usage…</p>;
  if (!summary.enabled) return <p className="text-xs text-slate-500">Usage counting is turned off on this server.</p>;

  const rows = usageRows(summary);
  const warn = rows.some((r) => r.today.warn || r.minute.warn || r.tokens?.warn);
  return (
    <div className="space-y-3">
      {warn && <p className="text-xs font-semibold text-red-700">Close to a limit (80% or more used).</p>}
      {rows.map((row) => (
        <div key={row.model} className="space-y-1.5">
          <p className="text-sm">
            {row.title} <span className="text-xs text-slate-500">({row.subtitle})</span>
          </p>
          <Meter label="Requests today" m={row.today} />
          <Meter label="Requests this minute" m={row.minute} />
          {row.tokens && <Meter label="Tokens this minute (estimated)" m={row.tokens} />}
          {row.limited && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-800">{row.limited}</p>}
        </div>
      ))}
      <p className="text-xs text-slate-500">
        Today&apos;s counts reset in {duration(summary.resetsInSec)}. This is an estimate: it counts only what this
        key did through Anchor{summary.persisted ? '' : ' since the server last started'}, and the limits are the
        free-tier defaults, not read from Google. Your real figures are in{' '}
        <a className="underline" href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer">Google AI Studio</a>.
      </p>
    </div>
  );
}
