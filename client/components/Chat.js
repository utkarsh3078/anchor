'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUp, BookOpen, ChevronDown, ClipboardPaste, Cpu, FileUp, ListTree, Paperclip, Plus, ScrollText, Search,
  SlidersHorizontal, Sparkles, TriangleAlert, X,
} from 'lucide-react';
import Answer from './Answer';
import Spark from './ui/Spark';
import { IrisIcon } from './ui/Iris';
import { plainError } from '@/lib/plain';

const pill =
  'inline-flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-sm font-medium text-fg ' +
  'transition-colors duration-200 ease-out hover:bg-surface-2 disabled:opacity-50';

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
    <div className="flex w-fit max-w-xl items-center gap-3 rounded-card border border-border bg-surface py-3 pl-3 pr-5 text-sm shadow-soft" role="status" aria-live="polite">
      <Spark className="size-9 shrink-0" busy />
      <span className="min-w-0">
        <span className="block break-words font-medium">Looking through {where}…</span>
        {slow && <span className="block text-muted">Still working on it. Thanks for waiting.</span>}
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
    <div className="rounded-card border border-danger/25 bg-danger-soft p-4 text-sm text-danger-fg sm:p-5" role="alert">
      <p>{text}</p>
      {switchModel && others.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={model} onChange={(e) => setModel(e.target.value)} aria-label="Another model"
            className="h-10 min-w-0 flex-1 rounded-full border border-border-strong bg-surface px-3 text-fg"
          >
            <option value="">Choose another model…</option>
            {others.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
          </select>
          <button
            type="button" disabled={!model} onClick={() => onSwitchModel(model, msg)}
            className="h-10 rounded-full bg-primary px-4 font-medium text-primary-fg disabled:opacity-50"
          >
            Switch and ask again
          </button>
        </div>
      )}
      <div className="mt-3 flex gap-4">
        {changeKey
          ? <button type="button" onClick={onChangeKey} className="font-medium underline underline-offset-4">Enter key again</button>
          : <button type="button" onClick={() => onRetry(msg)} className="font-medium underline underline-offset-4">Try again</button>}
      </div>
    </div>
  );
}

// Above the question box once the key has used 75% of a limit that the next question needs
function UsageWarning({ alert, onOpen, onDismiss }) {
  const tone = alert.level === 'danger'
    ? 'border-danger/25 bg-danger-soft text-danger-fg'
    : 'border-warn/30 bg-warn-soft text-warn-fg';
  return (
    <div className={`mx-auto mb-2 flex max-w-3xl items-start gap-2.5 rounded-card border px-3.5 py-2.5 text-sm ${tone}`} role="status" aria-live="polite">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {alert.text}{' '}
        <button type="button" onClick={onOpen} className="font-medium underline underline-offset-4">See key usage</button>
      </p>
      <button type="button" onClick={onDismiss} aria-label="Hide this warning" title="Hide" className="-m-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-fg/10">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

// Phones: icon beside the text, so three cards fit above the question box
const card =
  'flex items-center gap-4 rounded-card border border-border bg-surface p-4 text-left shadow-soft sm:flex-col sm:items-start sm:gap-0 ' +
  'transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lift sm:p-5';

function StartCard({ icon, title, text, href, onClick }) {
  const body = (
    <>
      <IrisIcon icon={icon} className="shrink-0" />
      <span className="min-w-0 sm:mt-8">
        <span className="block font-semibold">{title}</span>
        <span className="mt-1 block text-sm leading-snug text-muted">{text}</span>
      </span>
    </>
  );
  if (href) return <Link href={href} className={card}>{body}</Link>;
  return <button type="button" onClick={onClick} className={card}>{body}</button>;
}

// The first screen of a chat: what to do next, as three cards. With nothing to ask about
// yet they add a document; after that they start a question in the box (they don't send
// it: each question uses the visitor's Gemini quota).
function Welcome({ docCount, searched, onAttach, onPaste, onStart }) {
  const many = searched.length > 1;
  const ready = searched.length > 0;
  let title = `Ask about your ${many ? 'documents' : 'document'}`;
  let detail = 'Every answer shows the page it came from, so you can check it.';
  if (docCount === 0) {
    title = 'Welcome to Anchor';
    detail = 'Add a PDF or a notes file, then ask anything about it.';
  } else if (!ready) {
    title = 'Tick a document to ask about it';
    detail = 'Questions look only in the documents that are ticked.';
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center py-6 text-center">
      <Spark className="size-24 sm:size-36" />
      <h1 className="mt-2 text-[2rem] font-semibold leading-tight sm:mt-4 sm:leading-none tracking-[-0.03em] text-balance sm:text-5xl">{title}</h1>
      <p className="mt-3 text-muted text-pretty">{detail}</p>

      <div className="mt-6 grid w-full gap-2.5 sm:mt-12 sm:grid-cols-3 sm:gap-4">
        {ready ? (
          <>
            <StartCard
              icon={ScrollText} title="Summarise" text="Get the main points in a few lines"
              onClick={() => onStart(`Summarise ${many ? 'my documents' : 'this document'}`)}
            />
            <StartCard
              icon={ListTree} title="List the topics" text="See what it covers, section by section"
              onClick={() => onStart(`What are the main topics in my ${many ? 'documents' : 'document'}?`)}
            />
            <StartCard
              icon={Search} title="Find a detail" text="A date, a rule, a definition, a number"
              onClick={() => onStart('What does it say about ')}
            />
          </>
        ) : (
          <>
            <StartCard icon={FileUp} title="Upload a document" text="A PDF, .txt or .md file, up to 25 MB" onClick={onAttach} />
            <StartCard icon={ClipboardPaste} title="Paste text" text="Notes or a passage, straight from your clipboard" onClick={onPaste} />
            <StartCard icon={BookOpen} title="How it works" text="What happens between your question and the answer" href="/#how" />
          </>
        )}
      </div>
    </div>
  );
}

// messages: { id, role: 'user' | 'assistant' | 'error', ... }; searched: names of the ticked documents
export default function Chat({
  className = '', messages, asking, docCount, searched, models, currentModel, showDetails,
  onAsk, onNewChat, onRetry, onSwitchModel, onModel, onChangeKey, onOpenSource, onAttach, onPaste, onOpenSettings,
  usageAlert, onOpenUsage, onDismissUsageAlert,
}) {
  const [query, setQuery] = useState('');
  const bottom = useRef(null);
  const box = useRef(null);
  const canAsk = searched.length > 0;
  const empty = messages.length === 0 && !asking;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, asking]);

  // The question box grows with its text, up to about six lines
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [query]);

  function submit(e) {
    e?.preventDefault();
    const q = query.trim();
    if (!q || asking || !canAsk) return;
    setQuery('');
    onAsk(q);
  }

  function start(text) {
    setQuery(text);
    box.current?.focus();
  }

  let placeholder = 'Ask a question about your document…';
  if (docCount === 0) placeholder = 'Upload a document first';
  else if (!canAsk) placeholder = 'Tick a document first';

  return (
    <main className={className}>
      {!empty && (
        <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-8">
          <p className="min-w-0 truncate text-sm text-muted">
            {canAsk ? <>Asking about <span className="font-medium text-fg">{searched.length === 1 ? searched[0] : `${searched.length} documents`}</span></> : 'No document selected'}
          </p>
          <button type="button" onClick={onNewChat} disabled={asking} className={`${pill} h-9 shrink-0`}>
            <Plus className="size-4" aria-hidden /> New chat
          </button>
        </header>
      )}

      {/* relative: screen-reader-only text inside (e.g. on citation marks) is absolutely
          positioned; without a positioned scroller it is laid out against the page, stays
          put while the messages scroll, and makes the whole page scrollable */}
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-8">
        {empty ? (
          <Welcome docCount={docCount} searched={searched} onAttach={onAttach} onPaste={onPaste} onStart={start} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-bubble rounded-br-md bg-primary px-4 py-2.5 text-primary-fg shadow-soft">
                    {msg.text}
                  </div>
                );
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
        )}
      </div>

      <div className="px-3 pb-3 sm:px-8 sm:pb-6">
        {usageAlert && <UsageWarning alert={usageAlert} onOpen={onOpenUsage} onDismiss={onDismissUsageAlert} />}
        <form
          onSubmit={submit}
          className="mx-auto max-w-3xl rounded-panel border border-border bg-surface/70 p-2.5 shadow-soft transition-shadow duration-200 has-[textarea:focus]:border-fg/45 has-[textarea:focus]:shadow-lift sm:p-3"
        >
          <div className="flex items-start gap-2.5 px-2 pt-1.5">
            <Sparkles className="mt-1 size-4 shrink-0 text-subtle" aria-hidden />
            <textarea
              ref={box}
              rows={1}
              value={query}
              maxLength={1000}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
              }}
              placeholder={placeholder}
              aria-label="Your question"
              disabled={!canAsk}
              className="min-h-11 w-full resize-none bg-transparent leading-6 outline-none placeholder:text-muted disabled:cursor-not-allowed"
            />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <button type="button" onClick={onAttach} className={`${pill} shrink-0`} title="Upload a document">
              <Paperclip className="size-4 text-muted" aria-hidden /> <span className="max-sm:sr-only">Attach</span>
            </button>
            <label className={`${pill} relative min-w-0 pr-8 has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2 has-[select:focus-visible]:outline-ring`} title="The model that writes the answer">
              <Cpu className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="sr-only">Model for answers</span>
              <select
                value={currentModel} onChange={(e) => onModel(e.target.value)}
                className="w-full min-w-0 max-w-[13rem] appearance-none truncate bg-transparent outline-none"
              >
                {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 size-4 text-muted" aria-hidden />
            </label>
            <button type="button" onClick={onOpenSettings} className={`${pill} shrink-0 max-sm:hidden`} title="Settings">
              <SlidersHorizontal className="size-4 text-muted" aria-hidden /> Settings
            </button>
            <button
              type="submit" disabled={asking || !canAsk || !query.trim()}
              aria-label={asking ? 'Asking…' : 'Ask'} title="Ask"
              className="ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-fg shadow-ink transition-[background-color,transform,opacity] duration-200 ease-out hover:bg-primary-hover active:scale-95 disabled:opacity-40"
            >
              <ArrowUp className="size-5" aria-hidden />
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
