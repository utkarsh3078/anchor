'use client';

import { useEffect, useState } from 'react';

import { API_URL } from '@/lib/api';
import { CHECK_TIMEOUT_MS, RECHECK_MS, RETRY_MS, STATUS_HINT, STATUS_TEXT, statusFrom } from '@/lib/health';

const DOT = {
  checking: 'bg-muted',
  connecting: 'bg-danger',
  connected: 'bg-ok',
  degraded: 'bg-warn',
};

async function check() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/api/health`, { cache: 'no-store', signal: ctrl.signal });
    return statusFrom({ status: res.status });
  } catch {
    return statusFrom(null);
  } finally {
    clearTimeout(timer);
  }
}

// Green "Connected" / red "Connecting. Please wait" light. Checking also wakes a sleeping
// server, so it is usually awake by the time the visitor reaches the chat.
export default function ServerStatus({ className = '' }) {
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    let stopped = false;
    let timer;

    async function loop() {
      clearTimeout(timer);
      const next = await check();
      if (stopped) return;
      setStatus(next);
      // Retry quickly until the server answers; after that only an occasional recheck
      if (next !== 'connected') timer = setTimeout(loop, RETRY_MS);
      else if (document.visibilityState === 'visible') timer = setTimeout(loop, RECHECK_MS);
    }
    const onVisible = () => { if (document.visibilityState === 'visible') loop(); };

    loop();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const text = STATUS_TEXT[status];
  const waiting = status === 'connecting' || status === 'checking';
  return (
    <div
      role="status"
      aria-live="polite"
      title={STATUS_HINT[status]}
      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface/70 p-2 text-xs font-medium text-fg sm:px-3 sm:py-1.5 ${className}`}
    >
      <span className="relative flex size-2.5" aria-hidden>
        {waiting && <span className={`absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping ${DOT[status]}`} />}
        <span className={`relative size-2.5 rounded-full ${DOT[status]}`} />
      </span>
      {/* Phones: the dot only (the header has no room), the words stay for screen readers */}
      <span className="sr-only sm:not-sr-only">{text}</span>
    </div>
  );
}
