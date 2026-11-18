// Visitor ratings of answers ("Was this helpful?"). A rating belongs to one stored answer
// (messages.messageId) and to the key that asked it; it can be changed or taken back.
// Ratings are opinions, not correctness: the results page shows them as their own number
// and never mixes them into the measured accuracy. Thumbs-down answers can be exported as
// draft test questions (eval/feedback.js), which is how they improve the evaluation.

export const RATINGS = ['up', 'down'];
export const MAX_COMMENT = 500;

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });

// body -> { messageId, rating: 'up' | 'down' | null, comment: string | null }
export function parseFeedback(body = {}) {
  const { messageId, rating = null } = body;
  if (typeof messageId !== 'string' || !/^[\w-]{1,64}$/.test(messageId)) throw bad('messageId must be the id of an answer');
  if (rating !== null && !RATINGS.includes(rating)) throw bad('rating must be "up", "down" or null');
  let comment = body.comment ?? null;
  if (comment !== null) {
    if (typeof comment !== 'string') throw bad('comment must be text');
    comment = comment.trim().slice(0, MAX_COMMENT) || null;
  }
  if (rating === null) comment = null; // taking the rating back drops the comment too
  return { messageId, rating, comment };
}

// Sets (or, with rating null, removes) the rating on the caller's own answer.
// Returns false when no such answer belongs to this key.
export async function saveFeedback(messages, { owner, messageId, rating, comment }, now = new Date()) {
  const update = rating
    ? { $set: { feedback: { rating, comment, at: now } } }
    : { $unset: { feedback: '' } };
  const { matchedCount } = await messages.updateOne({ messageId, owner }, update);
  return matchedCount > 0;
}

// Totals for the results page: rows = [{ rating, abstained, at }] (one per rated message).
// Answers and "not in your document" replies are counted apart, since a thumbs-down on a
// refusal means something different from a thumbs-down on an answer.
export function feedbackTotals(rows) {
  const part = (xs) => {
    const up = xs.filter((r) => r.rating === 'up').length;
    const down = xs.filter((r) => r.rating === 'down').length;
    return { rated: up + down, up, down, helpfulRate: up + down ? up / (up + down) : null };
  };
  const times = rows.map((r) => new Date(r.at).getTime()).filter(Number.isFinite);
  return {
    ...part(rows),
    answers: part(rows.filter((r) => !r.abstained)),
    refusals: part(rows.filter((r) => r.abstained)),
    first: times.length ? new Date(Math.min(...times)).toISOString() : null,
    last: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}

// Reads every rated message (rating, whether it was a refusal, when) and totals them
export async function loadFeedbackTotals(messages) {
  const rows = await messages.find({ 'feedback.rating': { $in: RATINGS } }, { projection: { _id: 0, abstained: 1, 'feedback.rating': 1, 'feedback.at': 1 } }).toArray();
  return feedbackTotals(rows.map((m) => ({ rating: m.feedback.rating, abstained: Boolean(m.abstained), at: m.feedback.at })));
}
