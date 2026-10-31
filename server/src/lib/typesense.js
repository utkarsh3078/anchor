import Typesense from 'typesense';
import { config } from '../config.js';

export const COLLECTION = 'chunks';

export const ts = new Typesense.Client({
  nodes: [{
    host: config.typesense.host,
    port: config.typesense.port,
    protocol: config.typesense.protocol,
  }],
  apiKey: config.typesense.apiKey,
  connectionTimeoutSeconds: 10,
});

export async function ensureCollection() {
  try {
    await ts.collections(COLLECTION).retrieve();
  } catch {
    await ts.collections().create({
      name: COLLECTION,
      fields: [
        { name: 'docId', type: 'string', facet: true },
        { name: 'docName', type: 'string' },
        { name: 'page', type: 'int32' },
        { name: 'chunkIndex', type: 'int32' },
        { name: 'text', type: 'string' },
        { name: 'embedding', type: 'float[]', num_dim: config.gemini.dim },
      ],
    });
    console.log('Created Typesense collection:', COLLECTION);
  }
}
