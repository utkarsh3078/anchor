'use client';

import { useState } from 'react';
import { Check, ThumbsDown, ThumbsUp } from 'lucide-react';
import { nextRating } from '@/lib/feedback';
import { plainError } from '@/lib/plain';

const thumb =
  'inline-flex size-8 items-center justify-center rounded-full border transition-colors duration-200 ' +
  'disabled:pointer-events-none disabled:opacity-60';
const idle = 'border-transparent text-muted hover:border-border-strong hover:bg-surface-2 hover:text-fg';

// "Was this helpful?" under an answer or a "not in your document" reply. A thumb saves the
// rating at once; a second click on it takes the rating back. After a thumbs-down an
// optional note says what was wrong. Ratings are stored with this answer (POST /api/feedback)
// and shown on the results page as people's opinion, apart from the measured accuracy.
// messageId: the answer's id (no id = the server couldn't store it: nothing is shown).
// onRate(messageId, rating, comment) -> Promise
export default function Feedback({ messageId, onRate, refusal = false }) {
  const [rating, setRating] = useState(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState('idle'); // idle | saving | noted | error
  const [error, setError] = useState('');
  if (!messageId || !onRate) return null;

  async function save(next, comment = null) {
    setState('saving');
    setError('');
    try {
      await onRate(messageId, next, comment);
      setRating(next);
      setState(comment ? 'noted' : 'idle');
    } catch (e) {
      setState('error');
      setError(e.code === 'rate_limited' ? plainError(e).text : 'Your rating couldn’t be saved. Please try again.');
    }
  }

  const saving = state === 'saving';
  const pressed = (r) => (rating === r ? 'border-border-strong bg-surface-2 text-fg' : idle);
  return (
    <div className="mt-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-muted">{refusal ? 'Was this right?' : 'Was this helpful?'}</span>
        <button
          type="button" aria-pressed={rating === 'up'} disabled={saving} onClick={() => save(nextRating(rating, 'up'))}
          className={`${thumb} ${pressed('up')}`} title={rating === 'up' ? 'Take back your rating' : 'Yes'}
        >
          <ThumbsUp className="size-4" aria-hidden /><span className="sr-only">Yes, helpful</span>
        </button>
        <button
          type="button" aria-pressed={rating === 'down'} disabled={saving} onClick={() => save(nextRating(rating, 'down'))}
          className={`${thumb} ${pressed('down')}`} title={rating === 'down' ? 'Take back your rating' : 'No'}
        >
          <ThumbsDown className="size-4" aria-hidden /><span className="sr-only">No, not helpful</span>
        </button>
        <span role="status" className="text-muted">
          {rating === 'up' && state !== 'error' && 'Thanks!'}
          {state === 'noted' && (
            <span className="inline-flex items-center gap-1"><Check className="size-3.5" aria-hidden /> Thanks, noted.</span>
          )}
        </span>
      </div>

      {rating === 'down' && state !== 'noted' && (
        <form
          className="mt-2 max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) save('down', note.trim());
          }}
        >
          <label htmlFor={`fb-${messageId}`} className="text-muted">What was wrong? (optional)</label>
          <textarea
            id={`fb-${messageId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2}
            placeholder="For example: wrong page, missing a point, it was in the document"
            className="mt-1 w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-sm placeholder:text-muted"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <button
              type="submit" disabled={saving || !note.trim()}
              className="h-8 rounded-full bg-primary px-4 text-xs font-medium text-primary-fg transition-colors duration-200 hover:bg-primary-hover disabled:opacity-50"
            >
              Send note
            </button>
            <span className="text-xs text-muted">Your question, the answer and this note are saved with the rating.</span>
          </div>
        </form>
      )}

      {state === 'error' && <p role="alert" className="mt-1.5 text-danger-fg">{error}</p>}
    </div>
  );
}
