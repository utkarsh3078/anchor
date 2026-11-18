// Draft test questions from rated answers (eval/feedback.js), and the check that keeps a
// draft out of an evaluation run until a person has finished it. Pure functions, tested.

// messages: stored /api/ask messages with feedback -> a dataset marked draft: true
export function draftDataset(messages, { name }) {
  const docs = [...new Set(messages.flatMap((m) => (m.citations ?? []).map((c) => c.docName)))].sort();
  const seen = new Set();
  const questions = [];
  for (const m of messages) {
    const key = m.query.trim().toLowerCase();
    if (seen.has(key)) continue; // the same question rated twice becomes one test question
    seen.add(key);
    questions.push({
      id: `fb-${String(m.messageId ?? questions.length + 1).slice(0, 8)}`,
      category: 'feedback',
      question: m.query,
      answerable: null, // set true or false
      answer: '', // the correct answer, if answerable
      gold: [], // [{ "doc": "<file name>", "page": <n> }] for every page that holds the answer
      review: {
        rating: m.feedback?.rating ?? null,
        comment: m.feedback?.comment ?? null,
        ratedAt: m.feedback?.at ? new Date(m.feedback.at).toISOString() : null,
        systemAnswer: m.abstained ? null : m.answer,
        abstained: Boolean(m.abstained),
        abstainReason: m.abstainReason ?? null,
        citedPages: [...new Set((m.citations ?? []).map((c) => `${c.docName} p.${c.page}`))],
        mode: m.mode ?? null,
        model: m.model ?? null,
      },
    });
  }
  return {
    name,
    draft: true,
    description: 'Draft from rated answers. Fill in answerable, answer and gold for every question (delete the ones you cannot check), add each document\'s file, then remove "draft".',
    docs: docs.map((d) => ({ name: d, file: '' })),
    questions,
  };
}

// Problems that stop a dataset from being run: [] when it is ready
export function datasetProblems(dataset) {
  const problems = [];
  if (dataset.draft) problems.push('it is marked "draft": finish the review, then remove "draft"');
  for (const q of dataset.questions ?? []) {
    if (typeof q.answerable !== 'boolean') problems.push(`${q.id}: answerable must be true or false`);
    else if (q.answerable && (!q.gold?.length || !q.answer)) problems.push(`${q.id}: an answerable question needs an answer and gold pages`);
  }
  return problems;
}
