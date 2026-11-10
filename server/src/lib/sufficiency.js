import { LruCache, cached } from './cache.js';
import { usage } from './usage.js';

// The evidence gate's middle zone: one Gemini request asking whether the retrieved
// passages are enough to answer the question. Uses the rewrite model (X-Gemini-Rewrite-Model),
// like the other helper call, so it can draw on a different free-tier quota from the answer.
const SYSTEM = `You check evidence for a document question-answering system.
Decide whether the numbered passages contain enough information to answer the question correctly.
sufficient=true only if the answer is stated in the passages.
If it is missing, only partly there, or needs outside knowledge, sufficient=false.`;

const SCHEMA = {
  type: 'object',
  properties: { sufficient: { type: 'boolean' } },
  required: ['sufficient'],
};

const verdicts = new LruCache(500);

export async function contextSufficient(question, hits, gemini) {
  const passages = hits.map((h, i) => `[${i + 1}] (${h.docName}, p.${h.page})\n${h.text}`).join('\n\n');
  const key = JSON.stringify([gemini.rewriteModel, question, hits.map((h) => h.id)]);
  const { value } = await cached(verdicts, key, gemini.useCache, async () => {
    const res = await gemini.ai.models.generateContent({
      model: gemini.rewriteModel,
      contents: `Passages:\n\n${passages}\n\nQuestion: ${question}`,
      config: { systemInstruction: SYSTEM, temperature: 0, responseMimeType: 'application/json', responseJsonSchema: SCHEMA },
    });
    usage.record(gemini, gemini.rewriteModel, { tokens: res.usageMetadata?.totalTokenCount ?? 0 });
    return JSON.parse(res.text).sufficient === true;
  });
  return value;
}
