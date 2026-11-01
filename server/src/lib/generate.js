import { LruCache, cached } from './cache.js';

// Complete but grounded: list-style questions (syllabus, steps, topics) get every item the
// passages contain, formatted as Markdown; every line carries its citation.
const SYSTEM = `Answer the question using ONLY the numbered passages. Rules:
1. Cite every sentence and every bullet with the passage number(s) it comes from, e.g. [2] or [1, 3].
2. If the passages do not state the answer, return answerable=false and answer="". Do not guess.
3. Never use outside knowledge, even if you know the answer.
4. Be complete: if the question asks for a list, syllabus, steps or topics, include every relevant
   item found in the passages, grouped under short headings (e.g. "**Unit 1**") with "- " bullets.
5. Be direct: start with the answer, no preamble or closing remarks. Short questions get short answers.
   If asked what a document contains or for a summary, summarise the passages (they are spread
   across the document) by topic.
6. Use Markdown only for headings in bold, "- " bullets and **bold** terms.`;

const SCHEMA = {
  type: 'object',
  properties: {
    answerable: { type: 'boolean' },
    answer: { type: 'string' },
  },
  required: ['answerable', 'answer'],
};

// Same model + question + passages at temperature 0 gives the same answer, so it is
// cached: re-asking or toggling UI modes back doesn't spend another request.
const answers = new LruCache(500);

// Handles [2] and [1, 3]
export function citedNumbers(text) {
  const nums = new Set();
  for (const m of text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const n of m[1].split(',')) nums.add(Number(n));
  }
  return [...nums].sort((a, b) => a - b);
}

// Citations are read from the [n] markers in the answer text itself, so they can't
// disagree with what the answer actually cites. Numbers with no matching passage are
// counted in invalidCitations (a faithfulness signal for the evaluation).
export async function generateAnswer(question, hits, gemini) {
  const passages = hits
    .map((h, i) => `[${i + 1}] (${h.docName}, p.${h.page})\n${h.text}`)
    .join('\n\n');

  const key = JSON.stringify([gemini.model, question, hits.map((h) => h.id)]);
  const { value, cached: fromCache } = await cached(answers, key, gemini.useCache, async () => {
    const res = await gemini.ai.models.generateContent({
      model: gemini.model,
      contents: `Passages:\n\n${passages}\n\nQuestion: ${question}`,
      config: {
        systemInstruction: SYSTEM,
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: SCHEMA,
      },
    });
    return JSON.parse(res.text);
  });

  const { answerable, answer = '' } = value;
  const nums = citedNumbers(answer);
  const valid = nums.filter((n) => n >= 1 && n <= hits.length);
  return {
    answerable: Boolean(answerable && answer.trim()),
    answer: answer.trim(),
    citations: valid.map((n) => ({ n, ...hits[n - 1] })),
    invalidCitations: nums.length - valid.length,
    model: gemini.model,
    cached: fromCache,
  };
}
