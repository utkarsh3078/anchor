'use client';

import { Layers, TriangleAlert } from 'lucide-react';
import Markdown from './Markdown';
import AnswerCheck from './AnswerCheck';
import AnswerDetails from './AnswerDetails';
import Evidence from './Evidence';
import Feedback from './Feedback';
import { abstainText, citedPages } from '@/lib/plain';

const box = 'rounded-card border border-border bg-surface p-4 shadow-soft sm:p-5';

// One answer in the simple view: the text with numbered citations and, under it, "From
// your document": the lines of the document each cited source contributed, with the page
// and a way to see them highlighted on it. No scores, weights, thresholds or verdicts
// unless "Show retrieval details" is on in Settings (then also the statement-by-statement
// answer check and the retrieval trace).
// Under both an answer and a "not in your document" reply: "Was this helpful?" (Feedback).
// data: the /api/ask response. docCount: how many documents the question searched.
export default function Answer({ data, query, docCount, showDetails, onOpenSource, onRate }) {
  const details = showDetails && <AnswerDetails data={data} query={query} onOpenSource={onOpenSource} />;
  if (data.abstained) {
    return (
      <div className={box}>
        <p className="text-base font-medium leading-7">{abstainText(docCount)}</p>
        <p className="mt-1 text-sm text-muted">
          Try asking in different words, or check that the right document is ticked.
        </p>
        <Feedback messageId={data.messageId} onRate={onRate} refusal />
        {details}
      </div>
    );
  }

  const { citations } = data;
  const { multiDoc } = citedPages(citations);
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
        <p className="mb-4 flex items-start gap-2 rounded-control bg-warn-soft px-3 py-2 text-sm text-warn-fg">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          I'm less sure about this answer. Please check it against the lines below.
        </p>
      )}
      {data.overview && (
        <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-muted">
          <Layers className="size-3.5 shrink-0" aria-hidden />
          A summary built from parts taken from across {docCount > 1 ? 'your documents' : 'your document'}
        </p>
      )}

      <div className="text-base leading-7">
        <Markdown text={data.answer} onCite={open} citeTitle={citeTitle} />
      </div>

      <Evidence data={data} multiDoc={multiDoc} onOpenSource={onOpenSource} />
      <Feedback messageId={data.messageId} onRate={onRate} />
      {showDetails && <AnswerCheck support={data.support} context={data.context} showDetails onOpenSource={onOpenSource} />}
      {details}
    </div>
  );
}
