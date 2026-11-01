import { geminiClient } from '../src/lib/gemini.js';
import { config } from '../src/config.js';

// LLM-as-judge for answer faithfulness and correctness. Using a Gemini model to grade
// Gemini answers can be biased in its favour; the paper should say so, and the manual
// external comparison is the check on it. Runs locally with GEMINI_API_KEY from .env.
// Model: --judge-model, else GEMINI_JUDGE_MODEL, else GEMINI_MODEL. Picking a different
// model from the answer model also spreads requests over two free-tier quotas.
const SYSTEM = `Grade one answer from a document Q&A system. Be strict and literal.
faithfulness (ANSWER vs CITED PASSAGES only):
  supported = every claim is stated in the cited passages; partial = main claim supported, some details not;
  unsupported = main claim not stated there, or nothing cited.
correctness (ANSWER vs REFERENCE ANSWER): correct = same meaning; partial = incomplete or partly wrong;
  incorrect = wrong; no_reference = no reference given.
note: at most 15 words.`;

const SCHEMA = {
  type: 'object',
  properties: {
    faithfulness: { type: 'string', enum: ['supported', 'partial', 'unsupported'] },
    correctness: { type: 'string', enum: ['correct', 'partial', 'incorrect', 'no_reference'] },
    note: { type: 'string' },
  },
  required: ['faithfulness', 'correctness', 'note'],
};

export function makeJudge(model = process.env.GEMINI_JUDGE_MODEL || config.gemini.genModel) {
  if (!config.gemini.apiKey) throw new Error('The judge needs GEMINI_API_KEY in .env (or run with --no-judge)');
  const ai = geminiClient(config.gemini.apiKey);

  return async function judgeAnswer({ question, reference, answer, citations }) {
    const passages = citations.length
      ? citations.map((c) => `[${c.n}] (${c.docName}, p.${c.page})\n${c.text}`).join('\n\n')
      : '(none)';
    const prompt = [
      `QUESTION: ${question}`,
      `REFERENCE ANSWER: ${reference ?? '(none)'}`,
      `ANSWER: ${answer}`,
      `CITED PASSAGES:\n${passages}`,
    ].join('\n\n');

    const res = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { systemInstruction: SYSTEM, temperature: 0, responseMimeType: 'application/json', responseJsonSchema: SCHEMA },
    });
    return { ...JSON.parse(res.text), judgeModel: model };
  };
}
