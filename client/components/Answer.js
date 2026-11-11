'use client';

import Markdown from './Markdown';
import AnswerDetails from './AnswerDetails';
import { abstainText, citedPages } from '@/lib/plain';

const chip =
  'rounded-full border border-border-strong bg-surface px-3 py-1 text-xs font-medium transition-colors duration-200 ' +
  'hover:border-accent hover:bg-accent-soft hover:text-accent-soft-fg';
const box = 'rounded-card border border-border bg-surface p-4 shadow-soft sm:p-5';

// One answer in the simple view: the text with numbered citations, the pages it came
// from, and "Why this answer?" (closed) with the supporting passages. No scores, weights
// or thresholds unless "Show retrieval details" is on under Advanced.
// data: the /api/ask response. docCount: how many documents the question searched.
export default function Answer({ data, query, docCount, showDetails, onOpenSource }) {
  const details = showDetails && <AnswerDetails data={data} query={query} onOpenSource={onOpenSource} />;
  if (data.abstained) {
    return (
      <div className={box}>
        <p className="font-serif text-[17px] leading-relaxed">{abstainText(docCount)}</p>
        <p className="mt-1 text-sm text-muted">
          Try asking in different words, or check that the right document is ticked.
        </p>
        {details}
      </div>
    );
  }

  const { citations } = data;
  const { multiDoc, pages } = citedPages(citations);
  const byNumber = new Map(citations.map((c) => [c.n, c]));
  const open = (n) => {
    const c = byNumber.get(n);
    if (c) onOpenSource(c);
  };
  const citeTitle = (n) => {
    const c = byNumber.get(n);
    return c ? `${c.docName}, page ${c.page}: open it` : undefined;
  };

  return (
    <div className={box}>
      {data.lowConfidence && (
        <p className="mb-3 rounded-control bg-warn-soft px-3 py-2 text-sm text-warn-fg">
          I'm less sure about this answer. Please check it against the pages below.
        </p>
      )}
      {data.overview && (
        <p className="mb-3 rounded-control bg-surface-2 px-3 py-2 text-sm text-muted">
          This is a summary built from parts taken from across {docCount > 1 ? 'your documents' : 'your document'}.
        </p>
      )}

      <div className="font-serif text-[17px] leading-relaxed">
        <Markdown text={data.answer} onCite={open} citeTitle={citeTitle} />
      </div>

      {pages.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
          <span className="text-muted">{multiDoc ? 'From' : `From ${pages[0].docName}:`}</span>
          {pages.map((p) => (
            <button key={`${p.docName}-${p.page}`} onClick={() => onOpenSource(p.first)} className={chip} title="Open this page">
              {multiDoc ? `${p.docName}, page ${p.page}` : `Page ${p.page}`}
            </button>
          ))}
        </div>
      )}

      <details className="mt-3 text-sm">
        <summary className="w-fit cursor-pointer select-none font-medium text-accent underline-offset-4 hover:underline">
          Why this answer?
        </summary>
        {citations.length === 0 ? (
          <p className="mt-2 text-muted">
            This answer doesn't point to a specific part of your document, so please double-check it.
          </p>
        ) : (
          <>
            <p className="mt-2 text-muted">
              It was written only from these parts of {multiDoc ? 'your documents' : 'your document'}.
              The numbers match the ones in the answer.
            </p>
            <ol className="mt-2 space-y-3">
              {citations.map((c) => (
                <li key={c.n} className="rounded-control border border-border bg-surface-2/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-accent-soft px-2 text-[11px] font-semibold leading-5 text-accent-soft-fg">{c.n}</span>
                    <span className="min-w-0 flex-1 truncate font-medium" title={c.docName}>{c.docName}, page {c.page}</span>
                    <button onClick={() => onOpenSource(c)} className={chip}>Show on the page</button>
                  </div>
                  <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{c.text}</p>
                </li>
              ))}
            </ol>
          </>
        )}
      </details>
      {details}
    </div>
  );
}
