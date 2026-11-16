// Comparison sheets (eval/external.js): one CSV per system with a row per question, the
// answer that system gave and a person's verdicts on it. Pure functions, unit-tested.

export const COLUMNS = ['id', 'split', 'category', 'answerable', 'question', 'reference', 'gold',
  'answer', 'abstained', 'correctness', 'citation', 'notes'];
export const CORRECTNESS = ['correct', 'partial', 'incorrect'];
export const CITATION = ['correct', 'wrong', 'none'];
const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0']);

// An empty sheet to fill in by hand. `answers` (question id -> row of an answers run)
// pre-fills what Anchor's own run already knows: the answer, whether it abstained, and
// whether it cited a gold page. Correctness is always left for the person grading.
export function sheetRows(questions, splits, answers = new Map()) {
  return questions.map((q) => {
    const a = answers.get(q.id);
    let citation = '';
    if (a && !a.abstained && q.answerable) citation = a.citations?.length ? (a.citedGold ? 'correct' : 'wrong') : 'none';
    return {
      id: q.id,
      split: splits.get(q.id) ?? '',
      category: q.category ?? '',
      answerable: q.answerable ? 'yes' : 'no',
      question: q.question,
      reference: q.answerable ? q.answer ?? '' : '(not in the documents: the right response is to say so)',
      gold: (q.gold ?? []).map((g) => `${g.doc} p.${g.page}`).join('; '),
      answer: a && !a.abstained ? a.answer : '',
      abstained: a ? (a.abstained ? 'yes' : 'no') : '',
      correctness: '',
      citation,
      notes: '',
    };
  });
}

// Filled sheet -> graded rows. A row with neither an answer nor "abstained" is still to
// do (pending); a value outside the allowed words is a problem to fix in the sheet.
// Verdicts that cannot apply are dropped: no correctness for an abstention or for an
// unanswerable question (answering one is wrong whatever it says), no citation for an abstention.
export function readSheet(records, questions) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const rows = [];
  const problems = [];
  const pending = [];
  for (const r of records) {
    const q = byId.get(r.id);
    if (!q) {
      problems.push(`${r.id || '(no id)'}: not a question of this dataset`);
      continue;
    }
    const flag = (r.abstained ?? '').toLowerCase();
    if (!flag && !r.answer) {
      pending.push(q.id);
      continue;
    }
    const correctness = (r.correctness ?? '').toLowerCase();
    const citation = (r.citation ?? '').toLowerCase();
    const bad = [];
    if (flag && !YES.has(flag) && !NO.has(flag)) bad.push(`abstained must be yes or no, not "${r.abstained}"`);
    if (correctness && !CORRECTNESS.includes(correctness)) bad.push(`correctness must be ${CORRECTNESS.join(' / ')}, not "${r.correctness}"`);
    if (citation && !CITATION.includes(citation)) bad.push(`citation must be ${CITATION.join(' / ')}, not "${r.citation}"`);
    if (bad.length) {
      problems.push(...bad.map((b) => `${q.id}: ${b}`));
      continue;
    }
    const abstained = YES.has(flag);
    rows.push({
      id: q.id,
      category: q.category ?? null,
      answerable: q.answerable,
      abstained,
      correctness: abstained || !q.answerable ? null : correctness || null,
      citation: abstained ? null : citation || null,
      answer: abstained ? null : r.answer,
      notes: r.notes || null,
    });
  }
  return { rows, problems, pending };
}

// Same text apart from line endings and spacing (a spreadsheet may change both)
export const sameText = (a, b) => (a ?? '').replace(/\s+/g, ' ').trim() === (b ?? '').replace(/\s+/g, ' ').trim();
