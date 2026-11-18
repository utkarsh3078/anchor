// Formatting and chart geometry for the results page (components/results). Pure functions,
// unit-tested with `npm test`. Input is the GET /api/results response.

// 0.965 -> "96.5%", 0.94 -> "94%"; null -> "–"
export function pct(x, digits = 1) {
  if (x == null) return '–';
  const v = Math.round(x * 100 * 10 ** digits) / 10 ** digits;
  return `${Number.isInteger(v) ? v : v.toFixed(digits)}%`;
}

// 430 -> "430 ms", 1314 -> "1.3 s", 0 -> "under 1 ms"
export function duration(ms) {
  if (ms == null) return '–';
  if (ms < 1) return 'under 1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

// Change between two shares in percentage points: 0.897 -> 0.965 = "+6.8 pts"; null when unchanged
export function pointsGained(from, to) {
  if (from == null || to == null) return null;
  const d = Math.round((to - from) * 1000) / 10;
  if (Math.abs(d) < 0.05) return null;
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pts`;
}

const CATEGORY = {
  exact: 'Exact facts', numeric: 'Numbers', list: 'Lists', definition: 'Definitions', paraphrase: 'Reworded questions',
};
export const categoryName = (c) => CATEGORY[c] ?? c;

// The four numbers the page opens with. Missing parts (no answer run yet) are left out.
export function headline(results) {
  const tiles = [];
  const anchor = results.answers?.modes.find((m) => m.mode === 'anchor-soft') ?? results.answers?.modes[0];
  const search = results.retrieval?.configs.find((c) => c.config === 'anchor') ?? results.retrieval?.configs.at(-1);
  if (anchor?.accuracy != null) {
    tiles.push({ key: 'accuracy', label: 'Answers correct', value: anchor.accuracy, detail: `${anchor.correct} of ${anchor.answerable} questions that have an answer in the documents` });
  }
  if (search) {
    tiles.push({ key: 'found', label: 'Right page found', value: search.recall, detail: `in the top ${results.retrieval.k} results the search returns` });
  }
  if (anchor?.unanswerable) {
    tiles.push({
      key: 'refused', label: 'Said “not in your document”', value: anchor.refused / anchor.unanswerable, fraction: [anchor.refused, anchor.unanswerable],
      detail: `when the answer really wasn’t there (${anchor.refused} of ${anchor.unanswerable})`,
    });
  }
  if (anchor?.citedRightPage != null) {
    tiles.push({ key: 'cited', label: 'Answers citing a right page', value: anchor.citedRightPage, detail: 'every answer shows the page it came from' });
  }
  return tiles;
}

// The search configurations as steps, each with what it adds over the best step before it.
// The single searches (meaning, keyword) are alternatives, not steps: they get no gain of
// their own, and the first combined step is compared with the better of them.
const SINGLE = new Set(['dense', 'bm25']);
export function pipelineSteps(configs = []) {
  let best = { recall: null, mrr: null };
  return configs.map((c) => {
    const single = SINGLE.has(c.config);
    const step = {
      ...c,
      recallGain: single ? null : pointsGained(best.recall, c.recall),
      mrrGain: single ? null : pointsGained(best.mrr, c.mrr),
    };
    if (c.recall != null && (best.recall == null || c.recall > best.recall)) best = { ...best, recall: c.recall };
    if (c.mrr != null && (best.mrr == null || c.mrr > best.mrr)) best = { ...best, mrr: c.mrr };
    return step;
  });
}

// Line-chart geometry for the threshold curve. points: [{ threshold, answerableKept, unanswerableCaught }].
// Returns SVG paths in a width x height box (y: 0% at the bottom, 100% at the top) plus
// the x position of every threshold, so the hover layer can snap to the nearest one.
export function thresholdGeometry(points, { width, height, pad = { top: 12, right: 16, bottom: 28, left: 40 } }) {
  if (!points.length) return null;
  const xs = points.map((p) => p.threshold);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (t) => pad.left + (x1 === x0 ? plotW / 2 : ((t - x0) / (x1 - x0)) * plotW);
  const y = (v) => pad.top + (1 - v) * plotH;
  const path = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.threshold).toFixed(1)},${y(p[key] ?? 0).toFixed(1)}`).join(' ');
  return {
    pad, plotW, plotH, x, y,
    kept: path('answerableKept'),
    caught: path('unanswerableCaught'),
    positions: points.map((p) => ({ ...p, px: x(p.threshold) })),
  };
}

// The point nearest to an x position (for the crosshair)
export function nearest(positions, px) {
  return positions.reduce((best, p) => (Math.abs(p.px - px) < Math.abs(best.px - px) ? p : best), positions[0]);
}
