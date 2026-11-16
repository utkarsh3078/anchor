// Plain words for the answer check (the server's `support`: every statement of an answer
// compared with the passage it cites). Pure functions, unit-tested with `npm test`.

const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);

// The pages citation numbers point to, e.g. "page 4" or "pages 2 and 4".
// context: the numbered passages the answer was written from (citation n = context[n - 1])
export function pagesOf(numbers, context = []) {
  const pages = [...new Set(numbers.map((n) => context[n - 1]?.page).filter((p) => p != null))];
  if (!pages.length) return 'the cited passage';
  return `${pages.length > 1 ? 'pages' : 'page'} ${list(pages)}`;
}

// The one line shown under an answer. null = nothing to show (no check, or no statements).
// tone 'ok' only when every statement matched.
export function checkHeadline(support) {
  const s = support?.summary;
  if (!s?.statements) return null;
  const rest = s.statements - s.supported;
  if (!rest) {
    return {
      tone: 'ok',
      text: s.statements === 1
        ? 'The statement in this answer matches the page it cites.'
        : `${s.statements === 2 ? 'Both' : `All ${s.statements}`} statements match the pages they cite.`,
    };
  }
  if (!s.supported) {
    return {
      tone: 'warn',
      text: s.statements === 1
        ? "I couldn't match this statement to the page it cites. Please read the source."
        : `I couldn't match these ${s.statements} statements to the pages they cite. Please read the source.`,
    };
  }
  return {
    tone: 'warn',
    text: `${s.supported} of ${s.statements} statements match the pages they cite. ${rest} ${rest === 1 ? 'needs' : 'need'} a look.`,
  };
}

// One statement's verdict in words: { tone: 'ok' | 'warn' | 'bad', text }
export function statementNote(s, context = []) {
  const where = pagesOf(s.cites, context);
  const also = s.elsewhere
    ? ` The matching text is in source ${s.elsewhere}${context[s.elsewhere - 1] ? ` (page ${context[s.elsewhere - 1].page})` : ''}.`
    : '';
  switch (s.status) {
    case 'supported':
      return { tone: 'ok', text: `Matches ${where}.` };
    case 'partial':
      if (s.missingNumbers?.length) {
        const nums = list(s.missingNumbers);
        return { tone: 'warn', text: `Check this: ${nums} ${s.missingNumbers.length > 1 ? "aren't" : "isn't"} in the cited passage.${also}` };
      }
      return { tone: 'warn', text: `Partly matches ${where}. The wording differs from the source.${also}` };
    case 'unsupported':
      return { tone: 'bad', text: `Couldn't match this to ${where}.${also}` };
    default:
      return { tone: 'bad', text: `No source is given for this statement.${also}` };
  }
}

// The passage a click on a statement should open: the one that backs it if the check
// found it elsewhere, else the first one it cites. undefined when there is none.
export function statementSource(s, context = []) {
  return context[(s.elsewhere ?? s.cites[0]) - 1];
}
