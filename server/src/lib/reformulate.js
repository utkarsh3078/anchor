import { LruCache, cached } from './cache.js';
import { usage } from './usage.js';

const SYSTEM = `Rewrite a search query for a document search engine.
Output exactly one query: at most 12 words, no quotes, no explanation, no answer.
Use different words from the queries already tried: synonyms, technical terms, expanded abbreviations.`;

const rewrites = new LruCache(500);

// weakHits are the best (but low-confidence) passages so far: they hint at the
// vocabulary the documents actually use. Kept short to keep the request small.
export async function reformulateQuery(question, triedQueries, weakHits, gemini) {
  const snippets = weakHits.slice(0, 2).map((h) => `- ${h.text.slice(0, 200)}`).join('\n');
  const prompt = [
    `Question: ${question}`,
    `Tried:\n${triedQueries.map((q) => `- ${q}`).join('\n')}`,
    `Nearest passages (may be off-topic):\n${snippets || '(none)'}`,
  ].join('\n');

  const key = JSON.stringify([gemini.rewriteModel, question, triedQueries, weakHits.slice(0, 2).map((h) => h.id)]);
  const { value } = await cached(rewrites, key, gemini.useCache, async () => {
    const res = await gemini.ai.models.generateContent({
      model: gemini.rewriteModel,
      contents: prompt,
      config: { systemInstruction: SYSTEM, temperature: 0 },
    });
    usage.record(gemini, gemini.rewriteModel, { tokens: res.usageMetadata?.totalTokenCount ?? 0 });
    return (res.text ?? '').trim().split('\n')[0].replace(/^["']|["']$/g, '').trim();
  });
  return value || question;
}
