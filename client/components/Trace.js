'use client';

import { useEffect, useState } from 'react';

const TOP = 5;
const pct = (x) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;
const secs = (ms) => (ms == null ? '' : `${(ms / 1000).toFixed(2)} s`);

// One clickable passage: where it is (doc · page), a snippet, its score, and whether the
// answer cited it. Clicking opens the source page with the passage highlighted.
function PassageRow({ rank, passage, score, bar, badges, cited, onOpen }) {
  if (!passage) return null;
  return (
    <button
      onClick={() => onOpen(passage)}
      className={`group flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-blue-50 ${cited ? 'bg-green-50' : ''}`}
      title="Open in the document"
    >
      <span className="w-5 shrink-0 pt-0.5 text-xs text-slate-400">{rank}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-xs font-medium">
          <span className="truncate">{passage.docName}</span>
          <span className="shrink-0 text-slate-500">· p.{passage.page}</span>
          {cited && <span className="shrink-0 rounded bg-green-200 px-1 text-[10px] text-green-900">cited [{cited}]</span>}
          {badges}
        </span>
        <span className="line-clamp-2 text-[11px] text-slate-500">{passage.text}</span>
        {bar != null && (
          <span className="mt-1 block h-1.5 rounded bg-slate-200">
            <span className="block h-1.5 rounded bg-blue-500" style={{ width: pct(bar) }} />
          </span>
        )}
      </span>
      {score != null && <span className="shrink-0 pt-0.5 font-mono text-[11px] text-slate-500">{score}</span>}
      <span className="shrink-0 pt-0.5 text-xs text-blue-600 opacity-0 group-hover:opacity-100">↗</span>
    </button>
  );
}

function Step({ n, title, note, children }) {
  return (
    <details open className="rounded border border-slate-200">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">{n}</span>
        {title}
        {note && <span className="ml-2 text-xs font-normal text-slate-500">{note}</span>}
      </summary>
      <div className="space-y-1 px-1 pb-2">{children}</div>
    </details>
  );
}

function WeightsBar({ weights }) {
  return (
    <div className="px-2">
      <div className="flex h-4 overflow-hidden rounded text-[10px] text-white">
        <div className="flex items-center justify-center bg-amber-500" style={{ width: pct(weights.keyword) }}>keyword {weights.keyword.toFixed(2)}</div>
        <div className="flex items-center justify-center bg-indigo-500" style={{ width: pct(weights.dense) }}>dense {weights.dense.toFixed(2)}</div>
      </div>
    </div>
  );
}

function Gauge({ score, threshold }) {
  const ok = score >= threshold;
  return (
    <div className="space-y-1 px-2">
      <div className="relative h-3 rounded bg-slate-200">
        <div className={`h-3 rounded ${ok ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: pct(score) }} />
        <div className="absolute -top-1 h-5 w-0.5 bg-slate-900" style={{ left: pct(threshold) }} title={`threshold ${threshold}`} />
      </div>
      <p className="text-xs text-slate-600">
        Best rerank score <b>{score.toFixed(3)}</b> vs threshold <b>{threshold}</b>:{' '}
        {ok ? 'confident, so Gemini answered' : 'too weak, so Anchor abstained without calling Gemini'}
      </p>
    </div>
  );
}

// Right panel: how the answer was produced, step by step
export default function Trace({ message, onOpen }) {
  const data = message?.data;
  const r = data?.retrieval;
  const [attemptIdx, setAttemptIdx] = useState(0);

  useEffect(() => {
    setAttemptIdx(r?.bestAttempt ?? 0);
  }, [r]);

  if (!r) return <p className="p-4 text-sm text-slate-500">Ask a question, or click “Show trace” on an answer.</p>;

  const attempt = r.attempts?.[attemptIdx];
  const view = attempt ?? r; // anchor: one attempt; hybrid/dense: the retrieval itself
  const trace = view.trace ?? {};

  // Passage text/location from wherever the response carries it
  const known = new Map();
  for (const [id, p] of Object.entries(trace.passages ?? {})) known.set(id, { id, ...p });
  for (const p of [...(view.hits ?? []), ...(data.context ?? []), ...(data.citations ?? [])]) {
    if (!known.has(p.id)) known.set(p.id, p);
  }
  const passage = (id) => known.get(id);
  const citedAs = new Map((data.citations ?? []).map((c) => [c.id, c.n]));
  const fmt = (x, d = 3) => (x == null ? null : x.toFixed(d));
  let step = 0;

  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="rounded bg-slate-50 p-3">
        <p className="text-xs text-slate-500">Question</p>
        <p className="font-medium">“{message.query}”</p>
        <p className="mt-1 text-xs text-slate-500">
          Mode <b>{data.mode}</b> · total {secs(data.latencyMs)}
          {data.timings && <> · retrieval {secs(data.timings.retrievalMs)} · answer {secs(data.timings.generateMs)}</>}
        </p>
      </div>

      {r.attempts && r.attempts.length > 1 && (
        <Step n={++step} title="Retry path" note={`${r.retries} ${r.retries === 1 ? 'retry' : 'retries'}`}>
          {r.attempts.map((a, i) => (
            <button
              key={i}
              onClick={() => setAttemptIdx(i)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${i === attemptIdx ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50'}`}
            >
              <span className="text-slate-400">#{i + 1}</span>
              <span className="flex-1 truncate font-mono">“{a.query}”</span>
              <span className="font-mono">{a.topScore.toFixed(3)}</span>
              {i === r.bestAttempt && <span className="rounded bg-green-200 px-1 text-[10px] text-green-900">used</span>}
            </button>
          ))}
          <p className="px-2 text-[11px] text-slate-500">Low confidence, so Gemini rewrote the query. Every attempt is scored against your original question; the best one is used. Click an attempt to inspect it below.</p>
        </Step>
      )}

      {(trace.routing || view.weights) && (
        <Step n={++step} title="Query routing" note={trace.routing ? 'chosen for this query' : 'static weights'}>
          <WeightsBar weights={trace.routing?.weights ?? view.weights} />
          {trace.routing && (
            <ul className="list-disc space-y-0.5 pl-8 pt-1 text-xs text-slate-600">
              {trace.routing.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          )}
        </Step>
      )}

      {trace.keyword && (
        <Step n={++step} title="Keyword search (BM25)" note={`top ${TOP} of ${trace.keyword.length}`}>
          {trace.keyword.length === 0 && <p className="px-2 text-xs text-slate-500">No word matches.</p>}
          {trace.keyword.slice(0, TOP).map((h) => (
            <PassageRow key={h.id} rank={h.rank} passage={passage(h.id)} score={fmt(h.score, 2)} cited={citedAs.get(h.id)} onOpen={onOpen} />
          ))}
        </Step>
      )}

      {trace.dense && (
        <Step n={++step} title="Semantic search (embeddings)" note={`top ${TOP} of ${trace.dense.length}`}>
          {trace.dense.slice(0, TOP).map((h) => (
            <PassageRow key={h.id} rank={h.rank} passage={passage(h.id)} score={fmt(h.score)} cited={citedAs.get(h.id)} onOpen={onOpen} />
          ))}
        </Step>
      )}

      {trace.fused && (
        <Step n={++step} title="Fusion (weighted RRF)" note="both lists merged by rank">
          {trace.fused.slice(0, TOP).map((f, i) => (
            <PassageRow
              key={f.id} rank={i + 1} passage={passage(f.id)} cited={citedAs.get(f.id)} onOpen={onOpen}
              badges={(
                <>
                  {f.ranks.keyword && <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-900">kw #{f.ranks.keyword}</span>}
                  {f.ranks.dense && <span className="shrink-0 rounded bg-indigo-100 px-1 text-[10px] text-indigo-900">sem #{f.ranks.dense}</span>}
                </>
              )}
            />
          ))}
        </Step>
      )}

      {trace.rerank && (
        <Step n={++step} title="Rerank (Cohere cross-encoder)" note="relevance 0–1">
          {trace.rerank.map((h, i) => (
            <PassageRow key={h.id} rank={i + 1} passage={passage(h.id)} score={fmt(h.score)} bar={h.score} cited={citedAs.get(h.id)} onOpen={onOpen} />
          ))}
        </Step>
      )}

      {!trace.keyword && view.hits && (
        <Step n={++step} title="Semantic search (embeddings)" note="dense baseline">
          {view.hits.map((h, i) => (
            <PassageRow key={h.id} rank={i + 1} passage={h} score={fmt(h.score)} cited={citedAs.get(h.id)} onOpen={onOpen} />
          ))}
        </Step>
      )}

      {r.confidence && (
        <Step n={++step} title="Confidence check">
          <Gauge score={r.confidence.topScore} threshold={r.confidence.threshold} />
        </Step>
      )}

      {data.context?.length > 0 && (
        <Step n={++step} title="What Gemini read" note={`${data.context.length} passages`}>
          {data.context.map((p, i) => (
            <PassageRow
              key={p.id} rank={i + 1} passage={p} cited={citedAs.get(p.id)} onOpen={onOpen}
              badges={p.neighbour && <span className="shrink-0 rounded bg-slate-200 px-1 text-[10px] text-slate-700">neighbour</span>}
            />
          ))}
          <p className="px-2 text-[11px] text-slate-500">Top hits plus the chunks right before and after them, so lists and units arrive whole. Green rows are the ones the answer cites.</p>
        </Step>
      )}
    </div>
  );
}
