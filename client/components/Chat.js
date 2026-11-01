'use client';

import { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown';
import Thinking from './Thinking';

const ABSTAIN_TEXT = {
  low_retrieval_confidence: 'The retrieved evidence was too weak to answer reliably.',
  not_in_passages: 'The retrieved passages do not contain the answer.',
  no_passages: 'Nothing relevant was found in the selected documents.',
};

function AssistantMessage({ msg, active, onShowTrace, onOpenSource }) {
  const { data } = msg;
  const open = (n) => {
    const c = data.citations.find((x) => x.n === n);
    if (c) onOpenSource(c);
  };

  return (
    <div className={`rounded-lg border bg-white p-4 ${active ? 'border-blue-300' : 'border-slate-200'}`}>
      {data.abstained ? (
        <p className="font-serif text-slate-700">
          <span className="font-sans text-xs font-semibold uppercase text-amber-700">Abstained · </span>
          {ABSTAIN_TEXT[data.abstainReason] ?? data.abstainReason}
        </p>
      ) : (
        <div className="font-serif text-[17px] leading-relaxed">
          <Markdown text={data.answer} onCite={open} />
        </div>
      )}

      {data.citations.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sources (click to open)</p>
          <div className="flex flex-wrap gap-2">
            {data.citations.map((c) => (
              <button
                key={c.n}
                onClick={() => onOpenSource(c)}
                title={c.text.slice(0, 200)}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:border-blue-400 hover:bg-blue-50"
              >
                <span className="font-semibold text-blue-800">[{c.n}]</span> {c.docName} · p.{c.page}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
        <span>{data.mode}</span>
        <span>{(data.latencyMs / 1000).toFixed(1)} s</span>
        {data.model && <span>{data.model}{data.cached ? ' (cached)' : ''}</span>}
        <button onClick={onShowTrace} className="ml-auto underline">Show trace</button>
      </div>
    </div>
  );
}

// Error from /api/ask; a Gemini quota offers an inline model switch and retry
function ErrorMessage({ msg, models, onSwitchModel, onRetry }) {
  const { error } = msg;
  const [model, setModel] = useState('');
  const quota = error.code === 'gemini_quota';
  const others = models.filter((m) => m.id !== error.body?.model);

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p>{error.message}</p>
      {quota && others.length > 0 && (
        <div className="mt-2 flex gap-2">
          <select value={model} onChange={(e) => setModel(e.target.value)} className="flex-1 rounded border border-red-300 bg-white px-2 py-1 text-slate-900">
            <option value="">Switch to another model…</option>
            {others.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
          </select>
          <button
            disabled={!model}
            onClick={() => onSwitchModel(model)}
            className="rounded bg-red-700 px-3 py-1 text-white disabled:opacity-50"
          >
            Switch
          </button>
        </div>
      )}
      <button onClick={() => onRetry(msg.query)} className="mt-2 text-xs underline">Ask again</button>
    </div>
  );
}

export default function Chat({
  messages, asking, askingMode, searchedDocs, canAsk, onAsk, onNewChat, onShowTrace, onOpenSource, traceId, models, onSwitchModel, onRetry,
}) {
  const [query, setQuery] = useState('');
  const bottom = useRef(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, asking]);

  function submit(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q || asking || !canAsk) return;
    setQuery('');
    onAsk(q);
  }

  return (
    <main className="flex h-full min-w-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h2 className="font-medium">Chat</h2>
        <button onClick={onNewChat} className="text-sm text-slate-600 underline">New chat</button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {messages.length === 0 && (
          <p className="mt-10 text-center text-slate-500">
            Ask a question about the selected documents. Answers cite the page they come from.
          </p>
        )}
        {messages.map((msg) => {
          if (msg.role === 'user') {
            return <div key={msg.id} className="ml-auto max-w-[80%] rounded-lg bg-slate-900 px-4 py-2 text-white">{msg.text}</div>;
          }
          if (msg.role === 'error') {
            return <ErrorMessage key={msg.id} msg={msg} models={models} onSwitchModel={onSwitchModel} onRetry={onRetry} />;
          }
          return (
            <AssistantMessage
              key={msg.id} msg={msg} active={msg.id === traceId}
              onShowTrace={() => onShowTrace(msg.id)} onOpenSource={onOpenSource}
            />
          );
        })}
        {asking && <Thinking mode={askingMode} docs={searchedDocs} />}
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t border-slate-200 bg-white p-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={canAsk ? 'Ask a question…' : 'Select at least one document first'}
          disabled={!canAsk}
          className="flex-1 rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100"
        />
        <button disabled={asking || !canAsk || !query.trim()} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
          Ask
        </button>
      </form>
    </main>
  );
}
