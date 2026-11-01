'use client';

const pct = (x) => `${Math.round(x * 100)}%`;

function Hits({ hits }) {
  return (
    <ol className="space-y-1">
      {hits.map((h, i) => (
        <li key={h.id} className="flex gap-2 text-xs">
          <span className="w-4 text-slate-400">{i + 1}</span>
          <span className="flex-1 truncate" title={h.text}>{h.docName} · p.{h.page}</span>
          <span className="font-mono text-slate-500">{h.score.toFixed(3)}</span>
        </li>
      ))}
    </ol>
  );
}

function Gauge({ score, threshold }) {
  const ok = score >= threshold;
  return (
    <div>
      <div className="relative h-3 rounded bg-slate-200">
        <div className={`h-3 rounded ${ok ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: pct(Math.min(score, 1)) }} />
        <div className="absolute -top-1 h-5 w-0.5 bg-slate-900" style={{ left: pct(threshold) }} title={`threshold ${threshold}`} />
      </div>
      <p className="mt-1 text-xs text-slate-600">
        Top rerank score {score.toFixed(3)} vs threshold {threshold} · {ok ? 'confident' : 'below threshold'}
      </p>
    </div>
  );
}

const Weights = ({ w }) => (w ? <span>keyword {w.keyword.toFixed(2)} · dense {w.dense.toFixed(2)}</span> : null);

// Right panel: how the answer was retrieved (routing, confidence, retries, passages)
export default function Trace({ message }) {
  const r = message?.data?.retrieval;

  return (
    <aside className="space-y-5 overflow-y-auto border-l border-slate-200 bg-white p-4 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Retrieval trace</h2>
      {!r && <p className="text-slate-500">Ask a question, or click “Show trace” on an answer.</p>}

      {r && (
        <>
          <p className="text-xs text-slate-600">
            Mode <b>{message.data.mode}</b> · {(r.latencyMs / 1000).toFixed(2)} s retrieval
          </p>

          {r.confidence && (
            <section className="space-y-2">
              <h3 className="font-medium">Confidence</h3>
              <Gauge score={r.confidence.topScore} threshold={r.confidence.threshold} />
            </section>
          )}

          {r.attempts ? (
            <section className="space-y-2">
              <h3 className="font-medium">Attempts ({r.retries} {r.retries === 1 ? 'retry' : 'retries'})</h3>
              {r.attempts.map((a, i) => (
                <div key={i} className={`rounded border p-2 ${i === r.bestAttempt ? 'border-green-300 bg-green-50' : 'border-slate-200'}`}>
                  <p className="text-xs text-slate-500">
                    #{i + 1}{i === r.bestAttempt ? ' · used' : ''} · top {a.topScore.toFixed(3)}
                  </p>
                  <p className="font-mono text-xs">“{a.query}”</p>
                  <p className="text-xs text-slate-500"><Weights w={a.weights} /></p>
                  {a.trace?.routing && (
                    <ul className="mt-1 list-disc pl-4 text-xs text-slate-500">
                      {a.trace.routing.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </section>
          ) : (
            r.weights && <p className="text-xs text-slate-500">Fusion weights: <Weights w={r.weights} /></p>
          )}

          <section className="space-y-2">
            <h3 className="font-medium">Passages used</h3>
            <Hits hits={r.hits} />
          </section>
        </>
      )}
    </aside>
  );
}
