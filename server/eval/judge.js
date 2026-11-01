import { ai } from '../src/lib/gemini.js';
import { config } from '../src/config.js';

// LLM-as-judge for answer faithfulness and correctness. Using a Gemini model to grade
// Gemini answers can be biased in its favour; the paper should say so, and the manual
// external comparison is the check on it. Model: GEMINI_JUDGE_MODEL, else GEMINI_MODEL.
const MODEL = process.env.GEMINI_JUDGE_MODEL || config.gemini.genModel;

const SYSTEM = `You grade answers produced by a document question-answering system. Be strict and literal.
faithfulness: compare the ANSWER only with the CITED PASSAGES.
  "supported" = every claim in the answer is stated in the cited passages
  "partial" = the main claim is supported but some details are not
  "unsupported" = the main claim is not stated in the cited passages (or nothing is cited)
correctness: compare the ANSWER with the REFERENCE ANSWER.
  "correct" = same meaning; "partial" = incomplete or partly wrong; "incorrect" = wrong;
  "no_reference" = no reference answer was given.
note: one short sentence explaining the grades.`;

const SCHEMA = {
  type: 'object',
  properties: {
    faithfulness: { type: 'string', enum: ['supported', 'partial', 'unsupported'] },
    correctness: { type: 'string', enum: ['correct', 'partial', 'incorrect', 'no_reference'] },
    note: { type: 'string' },
  },
  required: ['faithfulness', 'correctness', 'note'],
};

export async function judgeAnswer({ question, reference, answer, citations }) {
  const passages = citations.length
    ? citations.map((c) => `[${c.n}] (${c.docName}, page ${c.page})\n${c.text}`).join('\n\n')
    : '(none)';
  const prompt = [
    `QUESTION: ${question}`,
    `REFERENCE ANSWER: ${reference ?? '(none)'}`,
    `ANSWER: ${answer}`,
    `CITED PASSAGES:\n${passages}`,
  ].join('\n\n');

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { systemInstruction: SYSTEM, temperature: 0, responseMimeType: 'application/json', responseJsonSchema: SCHEMA },
  });
  return { ...JSON.parse(res.text), judgeModel: MODEL };
}
