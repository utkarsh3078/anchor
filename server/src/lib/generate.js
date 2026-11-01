import { ai } from './gemini.js';
import { config } from '../config.js';

const SYSTEM = `You answer questions using ONLY the numbered passages provided.
- Cite the passage that supports each claim with its number in brackets, e.g. [2].
- If the passages do not contain the answer, set "answerable" to false and leave "answer" empty.
- Never use outside knowledge, even if you know the answer.
- Be concise.`;

const SCHEMA = {
  type: 'object',
  properties: {
    answerable: { type: 'boolean' },
    answer: { type: 'string' },
  },
  required: ['answerable', 'answer'],
};

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
export async function generateAnswer(question, hits) {
  const passages = hits
    .map((h, i) => `[${i + 1}] (${h.docName}, page ${h.page})\n${h.text}`)
    .join('\n\n');

  const res = await ai.models.generateContent({
    model: config.gemini.genModel,
    contents: `Passages:\n\n${passages}\n\nQuestion: ${question}`,
    config: {
      systemInstruction: SYSTEM,
      temperature: 0,
      responseMimeType: 'application/json',
      responseJsonSchema: SCHEMA,
    },
  });

  const { answerable, answer = '' } = JSON.parse(res.text);
  const nums = citedNumbers(answer);
  const valid = nums.filter((n) => n >= 1 && n <= hits.length);
  return {
    answerable: Boolean(answerable && answer.trim()),
    answer: answer.trim(),
    citations: valid.map((n) => ({ n, ...hits[n - 1] })),
    invalidCitations: nums.length - valid.length,
  };
}
