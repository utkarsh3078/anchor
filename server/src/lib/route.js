import { tokenize } from './bm25.js';

// Query routing: choose keyword vs dense weights per query from cheap, explainable
// features. No LLM call, so it adds no latency. The adjustments are hand-set
// heuristics, not learned; the evaluation compares routed vs static weights.
//
//   exact terms (codes like CL-7Q, numbers, ACRONYMS, "quoted phrases")
//     -> keyword: BM25 matches them exactly, embeddings blur them
//   low vocabulary coverage (most query words never appear in the documents)
//     -> dense: the user is paraphrasing, so word matching has little to work with
//   short query fully covered by the vocabulary -> slightly toward keyword
//   long natural-language question -> slightly toward dense
const EXACT_TERM = /"[^"]+"|\b[A-Za-z]*\d[\w-]*\b|\b[A-Za-z]+-\d\w*\b|\b[A-Z]{2,}\b/;
const MIN_KEYWORD = 0.2;
const MAX_KEYWORD = 0.8;

// vocabulary: anything with .has(term), e.g. the BM25 index's postings Map
export function routeQuery(query, vocabulary) {
  const tokens = [...new Set(tokenize(query))];
  const covered = tokens.filter((t) => vocabulary.has(t)).length;
  const coverage = tokens.length ? covered / tokens.length : 0;
  const exactTerms = EXACT_TERM.test(query);

  let keyword = 0.5;
  const reasons = [];
  if (exactTerms) {
    keyword += 0.2;
    reasons.push('exact terms (code, number, acronym or quote) favour keyword');
  }
  if (coverage < 0.5) {
    keyword -= 0.2;
    reasons.push(`only ${Math.round(coverage * 100)}% of query words occur in the documents, favour dense`);
  } else if (coverage === 1 && tokens.length <= 3) {
    keyword += 0.1;
    reasons.push('short query, every word occurs in the documents');
  }
  if (tokens.length >= 8) {
    keyword -= 0.1;
    reasons.push('long natural-language question favours dense');
  }

  keyword = Math.min(MAX_KEYWORD, Math.max(MIN_KEYWORD, keyword));
  keyword = Math.round(keyword * 100) / 100;
  return {
    weights: { keyword, dense: Math.round((1 - keyword) * 100) / 100 },
    features: { tokens: tokens.length, coverage: Math.round(coverage * 100) / 100, exactTerms },
    reasons: reasons.length ? reasons : ['no strong signal, balanced weights'],
  };
}
