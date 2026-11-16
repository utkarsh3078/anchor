// Answer check: is each statement of an answer backed by the passage it cites?
// The answer is cut into statements (the text in front of each citation marker), and the
// words and numbers of every statement are looked up in the passages it cites. No API
// call: it runs on every answer for free and gives the same result every time.
// It compares wording, not meaning: a faithful paraphrase can score low and a statement
// that reuses the passage's words with a different meaning can score high. How well its
// verdicts agree with the judge is measured by the evaluation (eval/report.js); until
// that has been run on real data the cut-offs below are provisional.

// Share of a statement's content words that must be in the cited passage
export const SUPPORT_CUTOFFS = { supported: 0.6, partial: 0.3 };
// A piece of text with no citation counts as a statement from this many content words;
// shorter pieces ("Yes.", a list lead-in) are not claims worth flagging
const MIN_UNCITED_WORDS = 3;

const MARKER = String.raw`\[\d+(?:\s*,\s*\d+)*\]`;
// Markers in a row ("[1] [2]", "[1], [3]") are one citation group, as in the client
const CITES = new RegExp(`(${MARKER}(?:\\s*,?\\s*${MARKER})*)`);

const STOPWORDS = new Set(`a about above after again all also am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have having he her here hers
him his how i if in into is it its itself just may me might more most must my no nor not of off on once only or other our
ours out over own same shall she should so some such than that the their theirs them then there these they this those
through to too under until up upon us very was we were what when where which while who whom why will with would you your
yours`.split(/\s+/));

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

// Crude stemmer so "filters" / "filter" and "cleaned" / "cleaning" count as the same word:
// plural first, then -ing / -ed (only when a vowel is left, so "string" and "need" stay
// whole), then a final e. Both sides of the comparison go through it, so an odd stem
// only matters when two different words end up the same.
export function stem(word) {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ch|sh|ss|x|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);

  const cut = w.endsWith('ing') ? 3 : w.endsWith('ed') && !w.endsWith('eed') ? 2 : 0;
  if (cut && w.length - cut >= 2 && /[aeiouy]/.test(w.slice(0, -cut))) w = w.slice(0, -cut);
  if (w.length > 2 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

const normalise = (text) => text.normalize('NFKC').toLowerCase();

// Content words of a text as stem -> the word as written (kept for "not found" notes).
// Numbers are handled separately, single letters and stopwords carry no evidence.
export function contentWords(text) {
  const words = new Map();
  for (const w of normalise(text).match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (w.length < 2 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    const s = stem(w);
    if (!words.has(s)) words.set(s, w);
  }
  return words;
}

// "1,200" and "1200" are the same number, "05" and "5" too; "3, 4" stays two numbers
export function numbersIn(text) {
  const found = normalise(text).match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? [];
  return new Set(found.map((n) => n.replace(/,/g, '').replace(/^0+(?=\d)/, '')));
}

const stripMarkdown = (s) => s.replace(/\*\*|`/g, '').replace(/\*(\S[^*]*)\*/g, '$1').replace(/^[\s.,;:!?)\]]+/, '').trim();

// The answer as a list of statements: [{ text, cites: [n] }]. Headings are structure, not
// claims. Text after the last marker of a line is a statement without a citation when it
// is long enough and is not a lead-in ending with a colon.
export function splitStatements(answer) {
  const statements = [];
  for (const raw of answer.split('\n')) {
    const line = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '');
    if (!line || /^#{1,4}\s/.test(line) || /^\*\*[^*]+\*\*:?$/.test(line)) continue;
    const parts = line.split(CITES);
    for (let i = 0; i < parts.length; i += 2) {
      const text = stripMarkdown(parts[i]);
      const marker = parts[i + 1];
      if (marker) {
        const cites = [...new Set(marker.match(/\d+/g).map(Number))];
        if (contentWords(text).size || numbersIn(text).size) statements.push({ text, cites });
      } else if (!text.endsWith(':') && contentWords(text).size >= MIN_UNCITED_WORDS) {
        statements.push({ text, cites: [] });
      }
    }
  }
  return statements;
}

// What a passage offers as evidence. The model is shown "(name, p.N)" above each passage,
// so a document name or page number in a statement can come from there.
function evidence(passages) {
  const text = passages.map((p) => `${p.docName ?? ''} ${p.page ?? ''}\n${p.text}`).join('\n');
  const words = contentWords(text);
  const numbers = numbersIn(text);
  NUMBER_WORDS.forEach((w, n) => {
    if (words.has(stem(w))) numbers.add(String(n)); // "three units" backs "3 units"
  });
  return { words, numbers };
}

function compare(words, numbers, ev) {
  const missing = [...words].filter(([s]) => !ev.words.has(s)).map(([, w]) => w);
  return {
    coverage: words.size ? (words.size - missing.length) / words.size : null,
    missingTerms: missing,
    missingNumbers: [...numbers].filter((n) => !ev.numbers.has(n)),
  };
}

// Longest quote shown for one statement
const QUOTE_MAX = 300;

// Words of a text with their positions: [{ start, end, key }]. key is what a statement's
// word or number must equal to count as the same; null for stopwords and single letters.
function wordSpans(text) {
  const spans = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+(?:(?<=\d)[.,]\d+)*/gu)) {
    const w = normalise(m[0]);
    let key = null;
    if (/^[\d.,]+$/.test(w)) key = `#${[...numbersIn(w)][0]}`;
    else if (w.length > 1 && !STOPWORDS.has(w)) key = stem(w);
    spans.push({ start: m.index, end: m.index + m[0].length, key });
  }
  return spans;
}

const distinct = (hits) => new Set(hits.map((h) => h.key));

// The lines of a passage a statement was taken from: the sentence that shares the most
// words and numbers with it, plus a neighbouring sentence when that adds at least two more.
// Always one unbroken slice of the passage, so the source viewer can highlight it on the
// page. Returns { quote, marks, clipped, score } or null when fewer than two of the
// statement's words are in any sentence (one is enough for a statement of one word).
//   marks    [start, end) positions inside `quote` of the shared words
//   clipped  the quote is a cut from a longer sentence (shown with "…")
//   score    how many different words and numbers of the statement the quote holds
export function quoteFor(statementText, passageText) {
  const wanted = new Set([...contentWords(statementText).keys(), ...[...numbersIn(statementText)].map((n) => `#${n}`)]);
  const hits = wordSpans(passageText).filter((w) => w.key && wanted.has(w.key));
  if (!hits.length) return null;
  const within = (from, to) => hits.filter((h) => h.start >= from && h.end <= to);

  // Sentences end at . ! ? followed by a space, or at a line break ("1.2 mg/L" stays whole)
  const cuts = [0, ...[...passageText.matchAll(/[.!?]+(?=\s)|\n+/g)].map((m) => m.index + m[0].length), passageText.length];
  const sentences = [];
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] > cuts[i - 1]) sentences.push({ start: cuts[i - 1], end: cuts[i], keys: distinct(within(cuts[i - 1], cuts[i])) });
  }
  const best = sentences.reduce((top, sn, i) => (sn.keys.size > sentences[top].keys.size ? i : top), 0);
  let { start, end } = sentences[best];
  const keys = new Set(sentences[best].keys);
  if (keys.size < Math.min(2, wanted.size)) return null;
  for (const near of [sentences[best + 1], sentences[best - 1]]) {
    const adds = near ? [...near.keys].filter((k) => !keys.has(k)) : [];
    if (adds.length >= 2 && Math.max(end, near.end) - Math.min(start, near.start) <= QUOTE_MAX) {
      start = Math.min(start, near.start);
      end = Math.max(end, near.end);
      adds.forEach((k) => keys.add(k));
    }
  }

  // A sentence too long to show (a list without full stops): keep the stretch of at most
  // QUOTE_MAX characters that holds the most shared words, widened to whole words
  let clipped = false;
  if (end - start > QUOTE_MAX) {
    const inside = within(start, end);
    let win = { count: 0 };
    inside.forEach((first, i) => {
      const run = inside.slice(i).filter((h) => h.end - first.start <= QUOTE_MAX);
      if (distinct(run).size > win.count) win = { count: distinct(run).size, from: first.start, to: run.at(-1).end };
    });
    const pad = Math.floor((QUOTE_MAX - (win.to - win.from)) / 2);
    let from = Math.max(start, win.from - pad);
    let to = Math.min(end, win.to + pad);
    if (from > start) from = passageText.indexOf(' ', from) + 1; // not in the middle of a word
    if (to < end) to = passageText.lastIndexOf(' ', to);
    start = Math.min(from, win.from);
    end = Math.max(to, win.to);
    clipped = true;
  }

  const slice = passageText.slice(start, end);
  const from = start + (slice.length - slice.trimStart().length);
  const quote = slice.trim();
  const shown = within(from, from + quote.length);
  return { quote, marks: shown.map((h) => [h.start - from, h.end - from]), clipped, score: distinct(shown).size };
}

// The best quote among the passages a statement cites: { n, quote, marks, clipped } or null
function evidenceFor(text, cited, passages) {
  let best = null;
  for (const n of cited) {
    const q = quoteFor(text, passages[n - 1].text);
    if (q && (!best || q.score > best.score)) best = { n, ...q };
  }
  if (!best) return null;
  const { score, ...evidence } = best;
  return evidence;
}

const passes = (c, cutoffs) => (c.coverage ?? 1) >= cutoffs.supported && !c.missingNumbers.length;

// passages: the numbered list the answer was written from (citation n = passages[n - 1]).
// Per statement:
//   supported    enough of its words and every number are in the passage(s) it cites
//   partial      some of its words are there, or a number is not
//   unsupported  few of its words are there
//   uncited      it cites nothing (or only numbers that match no passage)
// elsewhere: for a statement that is not supported, the number of another passage that
// does back it (a wrong or missing citation rather than an invented statement).
// evidence: the lines of a cited passage the statement was taken from (quoteFor), which
// the app shows under the answer as "From your document".
export function checkSupport(answer, passages, cutoffs = SUPPORT_CUTOFFS) {
  const each = passages.map((p) => evidence([p]));
  const statements = splitStatements(answer).map(({ text, cites }) => {
    const words = contentWords(text);
    const numbers = numbersIn(text);
    const valid = cites.filter((n) => n >= 1 && n <= passages.length);
    const c = valid.length
      ? compare(words, numbers, evidence(valid.map((n) => passages[n - 1])))
      : { coverage: null, missingTerms: [], missingNumbers: [] };

    let status = 'uncited';
    if (valid.length) {
      if (passes(c, cutoffs)) status = 'supported';
      else status = (c.coverage ?? 1) >= cutoffs.partial ? 'partial' : 'unsupported';
    }
    let elsewhere = null;
    if (status !== 'supported') {
      const i = each.findIndex((ev, idx) => !valid.includes(idx + 1) && passes(compare(words, numbers, ev), cutoffs));
      if (i !== -1) elsewhere = i + 1;
    }
    return {
      text, cites, status, elsewhere,
      evidence: evidenceFor(text, valid, passages),
      coverage: c.coverage == null ? null : Math.round(c.coverage * 100) / 100,
      missingTerms: c.missingTerms.slice(0, 8),
      missingNumbers: c.missingNumbers,
    };
  });

  const count = (status) => statements.filter((s) => s.status === status).length;
  return {
    method: 'lexical',
    statements,
    summary: {
      statements: statements.length,
      supported: count('supported'),
      partial: count('partial'),
      unsupported: count('unsupported'),
      uncited: count('uncited'),
    },
  };
}
