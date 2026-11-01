'use client';

import { useEffect, useState } from 'react';

// Shown while /api/ask runs. The server answers in one request without progress events,
// so the steps follow the real pipeline order on a timer; the last step stays active
// until the answer arrives.
const STEPS = {
  anchor: [
    { label: 'Reading your question', detail: 'Picking keyword vs meaning weights for it' },
    { label: 'Searching keywords', detail: 'BM25 over every passage' },
    { label: 'Searching by meaning', detail: 'Comparing embeddings' },
    { label: 'Merging results', detail: 'Weighted rank fusion' },
    { label: 'Reranking passages', detail: 'Cohere reads question and passage together' },
    { label: 'Checking the evidence', detail: 'Is it strong enough to answer?' },
    { label: 'Writing a cited answer', detail: 'Only from the retrieved passages' },
  ],
  hybrid: [
    { label: 'Searching keywords', detail: 'BM25 over every passage' },
    { label: 'Searching by meaning', detail: 'Comparing embeddings' },
    { label: 'Merging results', detail: 'Weighted rank fusion' },
    { label: 'Writing a cited answer', detail: 'Only from the retrieved passages' },
  ],
  dense: [
    { label: 'Understanding your question', detail: 'Turning it into an embedding' },
    { label: 'Searching by meaning', detail: 'Nearest passages in your documents' },
    { label: 'Writing a cited answer', detail: 'Only from the retrieved passages' },
  ],
};
const STEP_MS = 900;

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-blue-200 border-t-blue-600 motion-safe:animate-spin" />;
}

export default function Thinking({ mode = 'anchor', docs = [] }) {
  const steps = STEPS[mode] ?? STEPS.anchor;
  const [current, setCurrent] = useState(0);
  const [docIndex, setDocIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setCurrent((c) => Math.min(c + 1, steps.length - 1)), STEP_MS);
    return () => clearInterval(t);
  }, [steps.length]);

  // Cycle through the searched documents' names while searching
  useEffect(() => {
    if (docs.length < 2) return undefined;
    const t = setInterval(() => setDocIndex((i) => (i + 1) % docs.length), 1200);
    return () => clearInterval(t);
  }, [docs.length]);

  const writing = current === steps.length - 1;
  const doc = docs[docIndex % Math.max(docs.length, 1)];

  return (
    <div className="max-w-xl rounded-lg border border-blue-100 bg-white p-4 shadow-sm" role="status" aria-live="polite">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-600" />
        </span>
        <span className="font-medium text-slate-800">{writing ? 'Writing your answer…' : 'Looking through your documents…'}</span>
      </div>

      {doc && !writing && (
        <div className="mb-3 flex items-center gap-2 rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="text-base motion-safe:animate-bounce">📄</span>
          <span className="truncate">Scanning <b>{doc}</b></span>
        </div>
      )}

      <ol className="space-y-1.5">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.label} className={`flex items-start gap-2 text-sm transition-opacity duration-300 ${i > current ? 'opacity-35' : 'opacity-100'}`}>
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                {done && <span className="text-green-600">✓</span>}
                {active && <Spinner />}
                {!done && !active && <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}
              </span>
              <span>
                <span className={active ? 'font-medium text-slate-900' : 'text-slate-700'}>{s.label}</span>
                {active && <span className="block text-xs text-slate-500">{s.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 h-1 overflow-hidden rounded bg-slate-100">
        <div className="h-full w-1/3 rounded bg-blue-500 motion-safe:animate-[anchor-slide_1.2s_ease-in-out_infinite]" />
      </div>
    </div>
  );
}
