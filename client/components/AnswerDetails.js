'use client';

import Trace from './Trace';

const ABSTAIN_REASONS = {
  low_retrieval_confidence: 'no attempt reached the confidence threshold (strict mode), so Gemini was not asked',
  not_in_passages: 'Gemini found no answer in the retrieved passages',
  no_passages: 'nothing was retrieved from the selected documents',
};

// "Retrieval details" under an answer, shown only when turned on under Advanced: the
// same step-by-step trace as the classic view (scores, weights, confidence, retries).
export default function AnswerDetails({ data, query, onOpenSource }) {
  return (
    <details className="mt-2 text-sm">
      <summary className="w-fit cursor-pointer select-none text-slate-600 underline-offset-2 hover:underline">
        Retrieval details
      </summary>
      <div className="mt-2 rounded border border-slate-200">
        <p className="border-b border-slate-200 px-3 py-2 text-xs text-slate-600">
          {data.model && <>Model <b>{data.model}</b>{data.cached ? ' (cached answer)' : ''}</>}
          {data.abstained && <> · Abstained: {ABSTAIN_REASONS[data.abstainReason] ?? data.abstainReason}</>}
          {data.lowConfidence && <> · Answered below the confidence threshold</>}
        </p>
        <Trace message={{ data, query }} onOpen={onOpenSource} />
      </div>
    </details>
  );
}
