// Okapi BM25 implemented here because Typesense's text_match is not BM25
// (it ranks by matched tokens, typos and proximity, with no IDF weighting).
const STOPWORDS = new Set(`a an and are as at be but by for from has have he her his i if in into is it
its me my no not of on or our she so than that the their them then there these they this to us was we
were what when where which who why will with you your`.split(/\s+/));

export function tokenize(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t && !STOPWORDS.has(t) && (t.length > 1 || /\d/.test(t)));
}

// docs: [{ id, docId, docName, page, text }]
export function buildIndex(docs, { k1 = 1.2, b = 0.75 } = {}) {
  const postings = new Map(); // term -> [[docIdx, tf], ...]
  const lengths = new Array(docs.length);

  docs.forEach((doc, idx) => {
    const tokens = tokenize(doc.text);
    lengths[idx] = tokens.length;
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, n] of tf) {
      if (!postings.has(t)) postings.set(t, []);
      postings.get(t).push([idx, n]);
    }
  });

  const total = lengths.reduce((s, n) => s + n, 0);
  return { docs, postings, lengths, avgLen: docs.length ? total / docs.length : 0, k1, b };
}

// IDF is computed over the whole index, not just the filtered docs, so a chunk's
// score doesn't change when the user toggles other documents on or off.
export function searchIndex(index, query, { k = 10, docIds = [] } = {}) {
  const { docs, postings, lengths, avgLen, k1, b } = index;
  const N = docs.length;
  const allowed = docIds.length ? new Set(docIds) : null;
  const scores = new Map();

  for (const term of new Set(tokenize(query))) {
    const list = postings.get(term);
    if (!list) continue;
    const idf = Math.log(1 + (N - list.length + 0.5) / (list.length + 0.5));
    for (const [idx, tf] of list) {
      if (allowed && !allowed.has(docs[idx].docId)) continue;
      const norm = tf + k1 * (1 - b + (b * lengths[idx]) / avgLen);
      scores.set(idx, (scores.get(idx) || 0) + (idf * tf * (k1 + 1)) / norm);
    }
  }

  return [...scores]
    .sort((x, y) => y[1] - x[1])
    .slice(0, k)
    .map(([idx, score]) => {
      const { id, docName, page, text } = docs[idx];
      return { id, docName, page, text, score };
    });
}
