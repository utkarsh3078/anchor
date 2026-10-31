import 'dotenv/config';

export const config = {
  port: process.env.PORT || 4000,
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    embedModel: 'gemini-embedding-001',
    dim: 768, // must match num_dim in the Typesense schema
  },
  typesense: {
    host: process.env.TYPESENSE_HOST,
    port: Number(process.env.TYPESENSE_PORT),
    protocol: process.env.TYPESENSE_PROTOCOL,
    apiKey: process.env.TYPESENSE_API_KEY,
  },
};
