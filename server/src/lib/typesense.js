import Typesense from 'typesense';
import { config } from '../config.js';

export const COLLECTION = config.typesense.collection;

export const ts = new Typesense.Client({
  nodes: [{
    host: config.typesense.host,
    port: config.typesense.port,
    protocol: config.typesense.protocol,
  }],
  apiKey: config.typesense.apiKey,
  connectionTimeoutSeconds: 10,
});

// Short hash of the Gemini key that uploaded the chunk's document (lib/scope.js).
// Optional: chunks indexed before owners existed have none.
const OWNER_FIELD = { name: 'owner', type: 'string', facet: true, optional: true };

export async function ensureCollection() {
  let existing;
  try {
    existing = await ts.collections(COLLECTION).retrieve();
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
        OWNER_FIELD,
      ],
    });
    console.log('Created Typesense collection:', COLLECTION);
    return;
  }
  // A collection created before owners existed: add the field, existing chunks stay as they are
  if (!existing.fields.some((f) => f.name === OWNER_FIELD.name)) {
    await ts.collections(COLLECTION).update({ fields: [OWNER_FIELD] });
    console.log(`Added the "${OWNER_FIELD.name}" field to Typesense collection:`, COLLECTION);
  }
}
