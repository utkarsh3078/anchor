import { MongoClient } from 'mongodb';
import { config } from '../config.js';

// MongoDB is optional: without MONGODB_URI everything works except document metadata,
// chat history and eval-run logs, which are simply not stored.
let clientPromise = null;

// After a failed connection Mongo is treated as off for a minute, so an unreachable
// Atlas costs one 5 s wait per minute instead of one per request
const RETRY_AFTER_MS = 60_000;
let downUntil = 0;

export const mongoEnabled = () => Boolean(config.mongo.uri);

function getClient() {
  // The driver's default 30 s server-selection wait would stall every upload and answer
  // when Atlas is unreachable (e.g. this network's IP isn't allow-listed); fail fast instead
  clientPromise ??= new MongoClient(config.mongo.uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  }).connect().catch((e) => {
    clientPromise = null;
    downUntil = Date.now() + RETRY_AFTER_MS;
    console.error(`MongoDB unreachable (${e.message.slice(0, 120)}). Retrying in ${RETRY_AFTER_MS / 1000} s.`
      + ' On Atlas, check Network Access allows this IP.');
    throw e;
  });
  return clientPromise;
}

// Returns null when MongoDB isn't configured or is currently unreachable; callers then
// skip storing (or fall back to local files)
export async function getDatabase() {
  if (!mongoEnabled() || Date.now() < downUntil) return null;
  try {
    return (await getClient()).db(config.mongo.dbName);
  } catch {
    return null;
  }
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
