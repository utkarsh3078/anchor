'use client';

import { CircleAlert, CircleCheck, CircleX } from 'lucide-react';
import { checkHeadline, statementNote, statementSource } from '@/lib/support';

const TONES = {
  ok: { Icon: CircleCheck, icon: 'text-ok', text: 'text-ok-fg' },
  warn: { Icon: CircleAlert, icon: 'text-warn', text: 'text-warn-fg' },
  bad: { Icon: CircleX, icon: 'text-danger', text: 'text-danger-fg' },
};
const chip =
  'rounded-full border border-border-strong bg-surface px-3 py-1 text-xs font-medium transition-colors duration-200 ' +
  'hover:border-accent hover:bg-accent-soft hover:text-accent-soft-fg';

// The answer check, shown only with "Show retrieval details" on (the user did not want
// verdicts in the main view): one line saying how many statements match the pages
// they cite, and (closed) every statement with its verdict and a way to open its source.
// support: the /api/ask `support` (the server compares each statement's words and numbers
// with the passage it cites). context: the numbered passages the answer was written from.
// showDetails ("Show retrieval details" in Settings) adds the share of words found.
export default function AnswerCheck({ support, context, showDetails, onOpenSource }) {
  const head = checkHeadline(support);
  if (!head) return null;
  const { Icon, icon } = TONES[head.tone];

  return (
    <details className="mt-4 border-t border-border pt-4 text-sm">
      <summary className="cursor-pointer select-none">
        <Icon className={`mr-1.5 inline size-4 align-[-3px] ${icon}`} aria-hidden />
        <span className="font-medium">{head.text}</span>{' '}
        <span className="whitespace-nowrap text-accent underline-offset-4 hover:underline">See the check</span>
      </summary>

      <ol className="mt-3 space-y-2">
        {support.statements.map((s, i) => {
          const note = statementNote(s, context);
          const tone = TONES[note.tone];
          const source = statementSource(s, context);
          return (
            <li key={i} className="rounded-control border border-border bg-surface-2/60 p-3">
              <p className="break-words leading-relaxed">{s.text}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className={`flex min-w-0 flex-1 basis-56 items-start gap-1.5 text-[13px] ${tone.text}`}>
                  <tone.Icon className={`mt-0.5 size-4 shrink-0 ${tone.icon}`} aria-hidden />
                  {note.text}
                </span>
                {source && <button type="button" onClick={() => onOpenSource(source)} className={chip}>Show on the page</button>}
              </div>
              {showDetails && s.cites.length > 0 && (
                <p className="mt-2 text-xs text-muted">
                  {s.coverage == null ? 'Numbers only' : `${Math.round(s.coverage * 100)}% of its words are in the cited passage`}
                  {s.missingTerms?.length > 0 && <> · not found: {s.missingTerms.join(', ')}</>}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        How this check works: each statement's words and numbers are compared with the passage it cites.
        It can't judge meaning, so a statement worded differently from the source may be flagged even when it is right.
        When in doubt, open the page.
      </p>
    </details>
  );
}
