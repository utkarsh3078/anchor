'use client';

import { useState } from 'react';
import { BookOpenCheck } from 'lucide-react';
import { answerSources, markSegments } from '@/lib/evidence';

const FIRST = 3; // sources shown before "Show all"
const chip =
  'rounded-full border border-border-strong bg-surface px-3 py-1 text-xs font-medium transition-colors duration-200 ' +
  'hover:border-accent hover:bg-accent-soft hover:text-accent-soft-fg';

// One quoted line; a click opens its page with exactly this line highlighted
function Quote({ q, onOpen }) {
  return (
    <button
      type="button" onClick={onOpen} title="Show this line on the page"
      className="mt-2 block w-full rounded-r-control border-l-2 border-highlight pl-3 text-left leading-relaxed transition-colors duration-200 hover:bg-surface"
    >
      <span className="break-words">
        {q.clipped && !q.excerpt && '… '}
        {markSegments(q.quote, q.marks).map((seg, i) => (seg.mark
          ? <mark key={i} className="rounded-sm bg-highlight/70 text-fg">{seg.text}</mark>
          : <span key={i}>{seg.text}</span>))}
        {q.clipped && ' …'}
      </span>
    </button>
  );
}

// "From your document": the proof under an answer. One card per source the answer cites,
// with the exact lines of the document it was taken from (words the answer shares with
// them are marked), the page, and a button that opens that page with the lines highlighted.
// data: the /api/ask response. multiDoc: the answer cites more than one file.
export default function Evidence({ data, multiDoc, onOpenSource }) {
  const [all, setAll] = useState(false);
  const sources = answerSources(data);
  if (!sources.length) {
    return (
      <p className="mt-5 border-t border-border pt-4 text-sm text-muted">
        This answer doesn't point to a specific part of your document, so please double-check it.
      </p>
    );
  }
  const shown = all ? sources : sources.slice(0, FIRST);

  return (
    <section className="mt-5 border-t border-border pt-4 text-sm">
      <h4 className="flex items-center gap-2 font-semibold">
        <BookOpenCheck className="size-4 shrink-0 text-accent" aria-hidden />
        From your document
      </h4>
      <p className="mt-1 text-muted">
        This answer was written only from {multiDoc ? 'your documents' : sources[0].docName}. These are the lines it was
        taken from; the numbers match the ones in the answer.
      </p>

      <ol className="mt-3 space-y-2">
        {shown.map((src) => (
          <li key={src.n} className="rounded-control border border-border bg-surface-2/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent-soft px-2 text-[11px] font-semibold leading-5 text-accent-soft-fg">{src.n}</span>
              <span className="min-w-0 flex-1 truncate font-medium" title={src.docName}>
                {multiDoc ? `${src.docName}, page ${src.page}` : `Page ${src.page}`}
              </span>
              <button type="button" onClick={() => onOpenSource({ ...src, text: src.quotes[0].quote })} className={chip}>
                Show on the page
              </button>
            </div>
            {src.quotes.map((q) => <Quote key={q.quote} q={q} onOpen={() => onOpenSource({ ...src, text: q.quote })} />)}
            <details className="mt-2 text-[13px]">
              <summary className="w-fit cursor-pointer select-none text-muted underline-offset-4 hover:underline">Read the whole passage</summary>
              <p className="relative mt-2 max-h-48 overflow-y-auto overscroll-contain whitespace-pre-wrap leading-relaxed text-muted">{src.text}</p>
            </details>
          </li>
        ))}
      </ol>
      {sources.length > FIRST && !all && (
        <button type="button" onClick={() => setAll(true)} className="mt-3 font-medium text-accent underline-offset-4 hover:underline">
          Show all {sources.length} sources
        </button>
      )}
    </section>
  );
}
