import { ai } from './gemini.js';
import { config } from '../config.js';

const SYSTEM = `You rewrite search queries for a document search engine.
The user's question did not retrieve strong evidence. Write ONE new search query that is
more likely to match the wording of the source documents: use synonyms, likely technical
terms, or expand abbreviations. Do not answer the question. Reply with the query only.`;

// weakHits are the best (but low-confidence) passages so far: they hint at the
// vocabulary the documents actually use.
export async function reformulateQuery(question, triedQueries, weakHits) {
  const snippets = weakHits.slice(0, 3).map((h) => `- ${h.text.slice(0, 300)}`).join('\n');
  const prompt = [
    `Question: ${question}`,
    `Queries already tried:\n${triedQueries.map((q) => `- ${q}`).join('\n')}`,
    `Closest passages found so far (may be off-topic):\n${snippets || '(none)'}`,
  ].join('\n\n');

  const res = await ai.models.generateContent({
    model: config.gemini.genModel,
    contents: prompt,
    config: { systemInstruction: SYSTEM, temperature: 0 },
  });
  const query = (res.text ?? '').trim().split('\n')[0].replace(/^["']|["']$/g, '').trim();
  return query || question;
}
