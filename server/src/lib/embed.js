import { ai } from './gemini.js';
import { config } from '../config.js';

async function embed(texts, taskType) {
  const out = [];
  for (let i = 0; i < texts.length; i += 50) {
    const res = await ai.models.embedContent({
      model: config.gemini.embedModel,
      contents: texts.slice(i, i + 50),
      config: { taskType, outputDimensionality: config.gemini.dim },
    });
    out.push(...res.embeddings.map((e) => e.values));
  }
  return out;
}

// Documents and queries use different task types, which improves retrieval quality
export const embedDocuments = (texts) => embed(texts, 'RETRIEVAL_DOCUMENT');
export const embedQuery = async (q) => (await embed([q], 'RETRIEVAL_QUERY'))[0];
