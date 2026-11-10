'use client';

import Markdown from './Markdown';
import AnswerDetails from './AnswerDetails';
import { abstainText, citedPages } from '@/lib/plain';

const chip = 'rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:border-blue-400 hover:bg-blue-50';

// One answer in the simple view: the text with numbered citations, the pages it came
// from, and "Why this answer?" (closed) with the supporting passages. No scores, weights
// or thresholds unless "Show retrieval details" is on under Advanced.
// data: the /api/ask response. docCount: how many documents the question searched.
export default function Answer({ data, query, docCount, showDetails, onOpenSource }) {
  const details = showDetails && <AnswerDetails data={data} query={query} onOpenSource={onOpenSource} />;
  if (data.abstained) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="font-serif text-[17px] leading-relaxed">{abstainText(docCount)}</p>
        <p className="mt-1 text-sm text-slate-500">
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
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {data.lowConfidence && (
        <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          I'm less sure about this answer. Please check it against the pages below.
        </p>
      )}
      {data.overview && (
        <p className="mb-3 rounded bg-slate-100 px-3 py-2 text-sm text-slate-700">
          This is a summary built from parts taken from across {docCount > 1 ? 'your documents' : 'your document'}.
        </p>
      )}

      <div className="font-serif text-[17px] leading-relaxed">
        <Markdown text={data.answer} onCite={open} citeTitle={citeTitle} />
      </div>

      {pages.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
          <span className="text-slate-500">{multiDoc ? 'From' : `From ${pages[0].docName}:`}</span>
          {pages.map((p) => (
            <button key={`${p.docName}-${p.page}`} onClick={() => onOpenSource(p.first)} className={chip} title="Open this page">
              {multiDoc ? `${p.docName}, page ${p.page}` : `Page ${p.page}`}
            </button>
          ))}
        </div>
      )}

      <details className="mt-3 text-sm">
        <summary className="w-fit cursor-pointer select-none text-blue-700 underline-offset-2 hover:underline">
          Why this answer?
        </summary>
        {citations.length === 0 ? (
          <p className="mt-2 text-slate-600">
            This answer doesn't point to a specific part of your document, so please double-check it.
          </p>
        ) : (
          <>
            <p className="mt-2 text-slate-600">
              It was written only from these parts of {multiDoc ? 'your documents' : 'your document'}.
              The numbers match the ones in the answer.
            </p>
            <ol className="mt-2 space-y-3">
              {citations.map((c) => (
                <li key={c.n} className="rounded border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-blue-100 px-1.5 text-[11px] font-medium leading-5 text-blue-800">{c.n}</span>
                    <span className="min-w-0 flex-1 truncate font-medium" title={c.docName}>{c.docName}, page {c.page}</span>
                    <button onClick={() => onOpenSource(c)} className={chip}>Show on the page</button>
                  </div>
                  <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">{c.text}</p>
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
