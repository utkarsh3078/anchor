'use client';

import { useEffect, useRef, useState } from 'react';
import Answer from './Answer';
import { plainError } from '@/lib/plain';

// While /api/ask runs. The server sends no progress events, so this says only what is
// true: it is working, and (after a while) that it is still working.
function Loading({ docs }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, []);
  const where = docs.length === 1 ? docs[0] : 'your documents';

  return (
    <div className="flex max-w-xl items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm" role="status" aria-live="polite">
      <span className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full border-2 border-blue-200 border-t-blue-600 motion-safe:animate-spin" />
      <span className="min-w-0">
        <span className="block break-words font-medium text-slate-800">Looking through {where}…</span>
        {slow && <span className="block text-slate-500">Still working on it. Thanks for waiting.</span>}
      </span>
    </div>
  );
}

// A failed question, in plain words, with the ways out that apply to it
function ErrorMessage({ msg, models, currentModel, onRetry, onSwitchModel, onChangeKey }) {
  const { text, switchModel, changeKey } = plainError(msg.error);
  const [model, setModel] = useState('');
  const others = models.filter((m) => m.id !== currentModel);

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
      <p>{text}</p>
      {switchModel && others.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={model} onChange={(e) => setModel(e.target.value)} aria-label="Another model"
            className="min-w-0 flex-1 rounded border border-red-300 bg-white px-2 py-1 text-slate-900"
          >
            <option value="">Choose another model…</option>
            {others.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
          </select>
          <button
            disabled={!model} onClick={() => onSwitchModel(model, msg)}
            className="rounded bg-red-800 px-3 py-1 text-white disabled:opacity-50"
          >
            Switch and ask again
          </button>
        </div>
      )}
      <div className="mt-3 flex gap-4">
        {changeKey
          ? <button onClick={onChangeKey} className="underline">Enter key again</button>
          : <button onClick={() => onRetry(msg)} className="underline">Try again</button>}
      </div>
    </div>
  );
}

function EmptyState({ docCount, searched }) {
  let title = 'Ask a question about your document';
  let detail = 'Every answer shows the page it came from, so you can check it.';
  if (docCount === 0) {
    title = 'Upload a document to begin';
    detail = 'Add a PDF or text file on the left, then ask anything about it here.';
  } else if (searched.length === 0) {
    title = 'Tick a document to ask about it';
    detail = 'Questions look only in the documents ticked on the left.';
  } else if (searched.length > 1) {
    title = 'Ask a question about your documents';
  }
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <p className="text-lg font-medium text-slate-800">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </div>
  );
}

// messages: { id, role: 'user' | 'assistant' | 'error', ... }; searched: names of the ticked documents
export default function Chat({
  messages, asking, docCount, searched, models, currentModel, showDetails, onAsk, onNewChat, onRetry, onSwitchModel, onChangeKey, onOpenSource,
}) {
  const [query, setQuery] = useState('');
  const bottom = useRef(null);
  const canAsk = searched.length > 0;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, asking]);

  function submit(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q || asking || !canAsk) return;
    setQuery('');
    onAsk(q);
  }

  let placeholder = 'Ask a question…';
  if (docCount === 0) placeholder = 'Upload a document first';
  else if (!canAsk) placeholder = 'Tick a document first';

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3">
        <p className="min-w-0 truncate text-sm text-slate-600">
          {canAsk ? <>Asking about <span className="font-medium text-slate-900">{searched.length === 1 ? searched[0] : `${searched.length} documents`}</span></> : 'No document selected'}
        </p>
        {messages.length > 0 && (
          <button onClick={onNewChat} disabled={asking} className="shrink-0 text-sm text-slate-600 underline disabled:opacity-50">New chat</button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && !asking && <EmptyState docCount={docCount} searched={searched} />}
          {messages.map((msg) => {
            if (msg.role === 'user') {
              return <div key={msg.id} className="ml-auto w-fit max-w-[80%] rounded-lg bg-slate-900 px-4 py-2 text-white">{msg.text}</div>;
            }
            if (msg.role === 'error') {
              return (
                <ErrorMessage
                  key={msg.id} msg={msg} models={models} currentModel={currentModel}
                  onRetry={onRetry} onSwitchModel={onSwitchModel} onChangeKey={onChangeKey}
                />
              );
            }
            return (
              <Answer
                key={msg.id} data={msg.data} query={msg.query} docCount={msg.docCount}
                showDetails={showDetails} onOpenSource={onOpenSource}
              />
            );
          })}
          {asking && <Loading docs={searched} />}
          <div ref={bottom} />
        </div>
      </div>

      <form onSubmit={submit} className="border-t border-slate-200 bg-white p-4">
        <div className="mx-auto flex max-w-3xl gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label="Your question"
            disabled={!canAsk}
            className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100"
          />
          <button disabled={asking || !canAsk || !query.trim()} className="rounded bg-slate-900 px-5 py-2 text-white disabled:opacity-50">
            {asking ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </form>
    </main>
  );
}
