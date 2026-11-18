// "Was this helpful?" under answers, and the visitor-ratings part of the results page.
// Pure functions, unit-tested with `npm test`.

// Fewer ratings than this and the page says the number means little yet
export const FEW_RATINGS = 20;

// The next rating after a click: clicking the chosen thumb again takes the rating back
export const nextRating = (current, clicked) => (current === clicked ? null : clicked);

// What the results page says about visitor ratings. feedback: the /api/results `feedback`
// part (null when the server can't read ratings: the section is then left out).
export function ratingsSummary(feedback) {
  if (!feedback) return null;
  const a = feedback.answers ?? feedback;
  const r = feedback.refusals;
  return {
    rated: a.rated,
    helpful: a.up,
    notHelpful: a.down,
    rate: a.helpfulRate,
    state: a.rated === 0 ? 'none' : a.rated < FEW_RATINGS ? 'few' : 'enough',
    refusals: r?.rated
      ? `“Not in your document” replies were rated ${r.rated} time${r.rated === 1 ? '' : 's'}: ${r.up} helpful, ${r.down} not.`
      : null,
  };
}
