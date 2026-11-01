import { MongoClient } from 'mongodb';
import { config } from '../config.js';

// MongoDB is optional: without MONGODB_URI everything works except document metadata,
// chat history and eval-run logs, which are simply not stored.
let clientPromise = null;

export const mongoEnabled = () => Boolean(config.mongo.uri);

function getClient() {
  clientPromise ??= new MongoClient(config.mongo.uri).connect().catch((e) => {
    clientPromise = null;
    throw e;
  });
  return clientPromise;
}

// Returns null when MongoDB isn't configured
export async function getDatabase() {
  if (!mongoEnabled()) return null;
  return (await getClient()).db(config.mongo.dbName);
}

export async function collection(name) {
  return (await getDatabase())?.collection(name) ?? null;
}

// Logging must never fail the user's request, so errors are reported and swallowed
export async function safeWrite(name, fn) {
  try {
    const col = await collection(name);
    if (col) await fn(col);
  } catch (e) {
    console.error(`MongoDB write to ${name} failed:`, e.message);
  }
}

export async function closeDb() {
  if (clientPromise) await (await clientPromise).close();
  clientPromise = null;
}

export async function pingDb() {
  if (!mongoEnabled()) return 'disabled';
  try {
    await (await getClient()).db(config.mongo.dbName).command({ ping: 1 });
    return 'ok';
  } catch (e) {
    return `error: ${e.message}`;
  }
}
