import { attemptLog } from '../src/lib/signals.js';

// Gold evidence is page-level ({ doc, page }) because chunk ids change on every
// upload while page numbers don't.
export const isRelevant = (hit, gold) => gold.some((g) => g.doc === hit.docName && g.page === hit.page);

export const anyRelevant = (hits, gold) => hits.some((h) => isRelevant(h, gold));

// Fraction of gold pages that appear in the top k hits
export function recallAtK(hits, gold, k) {
  if (!gold.length) return 0;
  const top = hits.slice(0, k);
  return gold.filter((g) => top.some((h) => h.docName === g.doc && h.page === g.page)).length / gold.length;
}

// 1 / rank of the first relevant hit, 0 if none
export function reciprocalRank(hits, gold) {
  const i = hits.findIndex((h) => isRelevant(h, gold));
  return i === -1 ? 0 : 1 / (i + 1);
}

// Every reranked attempt of a retrieval response with its confidence signals, labelled
// with whether that attempt's hits contain a gold page (false for unanswerable questions:
// there is nothing to find). res: an anchor response (attempts[]) or a reranked hybrid one.
// [] for configs without a rerank.
export function labelledAttempts(res, q) {
  const hitsOf = (i) => (res.attempts ? res.attempts[i].hits : res.hits);
  return attemptLog(res, q.question)
    .map((a) => ({ ...a, goldRetrieved: q.answerable ? anyRelevant(hitsOf(a.attempt), q.gold) : false }));
}

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Nearest-rank percentile
export function percentile(xs, p) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

// Answer level. citations: [{ docName, page }]
// Share of an answer's citations that point at a gold page (null if nothing cited)
export function citationPrecision(citations, gold) {
  if (!citations.length) return null;
  return citations.filter((c) => isRelevant(c, gold)).length / citations.length;
}

// Shares of rows whose `field` equals each of `values`, e.g. { correct: 0.6, partial: 0.2 }
export function shares(rows, field, values) {
  return Object.fromEntries(values.map((v) => [v, rows.length ? rows.filter((r) => r[field] === v).length / rows.length : null]));
}

// Confidence-gate curve from recorded scores, no re-running needed. rows: [{ answerable, score }]
// At each threshold: share of answerable questions kept, share of unanswerable caught.
export function gateCurve(rows, thresholds) {
  const ans = rows.filter((r) => r.answerable);
  const unans = rows.filter((r) => !r.answerable);
  return thresholds.map((t) => ({
    threshold: t,
    answeredRate: mean(ans.map((r) => (r.score >= t ? 1 : 0))),
    abstainRate: mean(unans.map((r) => (r.score < t ? 1 : 0))),
  }));
}

// How a configuration decides to answer or abstain. rows: [{ answerable, answered, correct }];
// correct is true/false for an answered row, or null when nobody graded it. An answered
// unanswerable question is always wrong.
//   answerRate             answered / all questions
//   accuracyOnAnswered     correct / answered (graded answers only; `ungraded` counts the rest)
//   unanswerableRejection  unanswerable questions not answered / unanswerable questions
//   falseAbstention        answerable questions not answered / answerable questions
export function decisionMetrics(rows) {
  const answered = rows.filter((r) => r.answered);
  const graded = answered.filter((r) => r.correct != null);
  return {
    n: rows.length,
    answerRate: mean(rows.map((r) => (r.answered ? 1 : 0))),
    accuracyOnAnswered: mean(graded.map((r) => (r.correct ? 1 : 0))),
    ungraded: answered.length - graded.length,
    unanswerableRejection: mean(rows.filter((r) => !r.answerable).map((r) => (r.answered ? 0 : 1))),
    falseAbstention: mean(rows.filter((r) => r.answerable).map((r) => (r.answered ? 0 : 1))),
  };
}

// One point of a coverage-risk curve: answer every question whose score is at least
// `cutoff`. rows: [{ score, correct, passes }]; passes: false marks a question that
// would not be answered whatever the gate says (the answer step itself abstained).
// coverage = answered / all questions; risk = wrong answers / answered (null when none).
export function riskCoverageAt(rows, cutoff) {
  const answered = rows.filter((r) => r.score >= cutoff && r.passes !== false);
  return {
    cutoff,
    answered: answered.length,
    coverage: rows.length ? answered.length / rows.length : null,
    risk: answered.length ? answered.filter((r) => !r.correct).length / answered.length : null,
  };
}

// The whole curve: one point per distinct score, strictest cut-off first
export function riskCoverage(rows) {
  return [...new Set(rows.map((r) => r.score))].sort((a, b) => b - a).map((cutoff) => riskCoverageAt(rows, cutoff));
}

// Area under the coverage-risk curve: the risk averaged over the answers as they are
// admitted from the most to the least confident. Lower is better; a score that ranks
// every correct answer above every wrong one gives the lowest value possible for that
// set of answers. null when no question can be answered.
export function aurc(rows) {
  let area = 0;
  let previous = 0;
  for (const p of riskCoverage(rows)) {
    if (p.answered === previous) continue;
    area += (p.answered - previous) * p.risk;
    previous = p.answered;
  }
  return previous ? area / previous : null;
}

// The answer check (src/lib/support.js) over a set of answered rows; rows: [{ support }]
// with support.summary = { statements, supported, ... }. Rows without a check, or with
// nothing to check, are left out.
//   statementsMatched  statements backed by their cited passage / all statements
//   answersAllMatched  answers whose every statement is backed / answers checked
export const allMatched = (row) => row.support.summary.supported === row.support.summary.statements;

export function supportStats(rows) {
  const checked = rows.filter((r) => r.support?.summary?.statements > 0);
  const statements = checked.reduce((n, r) => n + r.support.summary.statements, 0);
  const matched = checked.reduce((n, r) => n + r.support.summary.supported, 0);
  return {
    answers: checked.length,
    statements,
    statementsMatched: statements ? matched / statements : null,
    answersAllMatched: mean(checked.map((r) => (allMatched(r) ? 1 : 0))),
  };
}

// Does the answer check agree with the judge? Judged rows are put in two groups by the
// check's verdict (every statement matched, or not); each group gets the judge's
// faithfulness counts and the share of its answers to answerable questions judged correct.
export function checkVsJudge(rows) {
  const usable = rows.filter((r) => r.support?.summary?.statements > 0 && r.faithfulness);
  return [true, false].map((pass) => {
    const group = usable.filter((r) => allMatched(r) === pass);
    const graded = group.filter((r) => r.answerable && r.correctness && r.correctness !== 'no_reference');
    return {
      allMatched: pass,
      answers: group.length,
      supported: group.filter((r) => r.faithfulness === 'supported').length,
      partial: group.filter((r) => r.faithfulness === 'partial').length,
      unsupported: group.filter((r) => r.faithfulness === 'unsupported').length,
      correct: mean(graded.map((r) => (r.correctness === 'correct' ? 1 : 0))),
    };
  });
}

// Hand-graded answers of any system (eval/external.js), one row per question:
// { answerable, abstained, correctness: 'correct' | 'partial' | 'incorrect' | null,
//   citation: 'correct' | 'wrong' | 'none' | null }. An answer to an unanswerable question
// needs no grade: it is wrong. An answerable question that was not answered is wrong too.
//   accuracy      correct / answerable questions (answered-but-ungraded rows left out)
//   partial       partly correct / the same questions
//   citedCorrect  answers to answerable questions that point at a gold page / those with a
//                 citation verdict; noCitation: those that cite nothing
// The four answer-or-abstain rates are the same as for Anchor's own modes (decisionMetrics).
export function externalSummary(rows) {
  const answerable = rows.filter((r) => r.answerable);
  const settled = answerable.filter((r) => r.abstained || r.correctness);
  const cited = answerable.filter((r) => !r.abstained && r.citation);
  const d = decisionMetrics(rows.map((r) => {
    let correct = null;
    if (!r.abstained) correct = r.answerable ? (r.correctness ? r.correctness === 'correct' : null) : false;
    return { answerable: r.answerable, answered: !r.abstained, correct };
  }));
  return {
    ...d,
    accuracy: mean(settled.map((r) => (!r.abstained && r.correctness === 'correct' ? 1 : 0))),
    partial: mean(settled.map((r) => (!r.abstained && r.correctness === 'partial' ? 1 : 0))),
    citedCorrect: mean(cited.map((r) => (r.citation === 'correct' ? 1 : 0))),
    noCitation: mean(cited.map((r) => (r.citation === 'none' ? 1 : 0))),
  };
}

// How often two graders give the same verdict. pairs: [{ a, b }]
export function agreement(pairs) {
  return { n: pairs.length, rate: mean(pairs.map((p) => (p.a === p.b ? 1 : 0))) };
}
