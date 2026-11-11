import { config } from '../config.js';
import { getKeywordIndex } from './retrievers.js';

// Each document belongs to the Gemini key that uploaded it (its short hash, the same one
// chats use), and a key sees, searches and deletes only its own documents. Documents
// indexed before owners were recorded have none and stay visible to every key.
// SHARED_DOCUMENTS=true turns all of this off: one library for everyone, as before.

// A docIds filter that matches nothing. An empty list can't be used for that: everywhere
// downstream it means "no filter", i.e. every document.
export const NO_DOCUMENTS = ['__no_documents__'];

export const canSee = (docOwner, owner) => !docOwner || docOwner === owner;

// requested: the docIds a request asked for ([] = all). owners: Map docId -> owner.
// Returns the docIds the search may use: the requested ones this owner can see, or all
// of the owner's when none were requested.
export function scopeDocIds(requested, owners, owner) {
  const visible = (id) => owners.has(id) && canSee(owners.get(id), owner);
  const ids = requested.length ? requested.filter(visible) : [...owners.keys()].filter(visible);
  if (!ids.length) return NO_DOCUMENTS;
  // Everything is visible and nothing was picked: no filter needed, exactly as before
  return !requested.length && ids.length === owners.size ? [] : ids;
}

// docId -> owner for everything indexed, read from the in-memory keyword index (rebuilt
// after every upload and delete), so scoping costs no extra Typesense call
const ownersOf = new WeakMap();
export async function docOwners() {
  const index = await getKeywordIndex();
  let owners = ownersOf.get(index);
  if (!owners) {
    owners = new Map();
    for (const d of index.docs) if (!owners.has(d.docId)) owners.set(d.docId, d.owner);
    ownersOf.set(index, owners);
  }
  return owners;
}

export async function scopedDocIds(requested, owner) {
  return config.sharedDocuments ? requested : scopeDocIds(requested, await docOwners(), owner);
}

// May this owner open or delete this document?
export async function canAccess(docId, owner) {
  if (config.sharedDocuments) return true;
  const owners = await docOwners();
  return owners.has(docId) && canSee(owners.get(docId), owner);
}
