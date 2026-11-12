// Plain-words text for the simple view. Pure functions (no React, no fetch) so they can
// be unit-tested with `npm test`.

// One message for every abstention reason: the reader only needs to know the answer
// is not in what they uploaded. (The reasons stay in the API response for the evaluation.)
export function abstainText(docCount = 1) {
  return docCount > 1 ? "I couldn't find this in your documents." : "I couldn't find this in your document.";
}

const GENERIC = 'Something went wrong. Please try again.';

// err: an ApiError ({ code, status, body }) or any Error.
// Returns { text, switchModel, changeKey }: what to say, and which way out to offer
// besides "Try again".
// upload: the request was an upload. Uploads (and the search step of a question) use
// Gemini's embedding model, which has its own limit and can't be swapped, so those quota
// messages don't offer a model switch.
export function plainError(err, { upload = false } = {}) {
  const out = (text, extra = {}) => ({ text, switchModel: false, changeKey: false, ...extra });
  const body = err?.body ?? {};
  const embedding = upload || /embedding/i.test(body.model ?? '');

  switch (err?.code) {
    case 'network':
      return out("Can't reach Anchor right now. Check your internet connection and try again.");
    case 'gemini_quota': {
      const wait = body.retryAfterSec ? `about ${body.retryAfterSec} seconds` : 'a minute';
      if (embedding) {
        return out(body.scope === 'day'
          ? "Your Gemini key has used up today's free limit for reading and searching documents. Try again tomorrow, or use a different key."
          : `Your Gemini key has hit its free limit for reading and searching documents. Wait ${wait} and try again.`);
      }
      if (body.scope === 'day') {
        return out("Your Gemini key has used up today's free limit for this model. Switch to another model, or try again tomorrow.", { switchModel: true });
      }
      return out(`Your Gemini key has hit its free limit for now. Wait ${wait} and try again, or switch to another model.`, { switchModel: true });
    }
    case 'gemini_key_invalid':
    case 'gemini_key_required':
      return out("Your Gemini key isn't working. Please enter it again.", { changeKey: true });
    case 'gemini_model_unavailable':
      return out("This model isn't available for your key. Please pick another one.", { switchModel: true });
    case 'gemini_unavailable':
      return out('Gemini is having trouble right now. Please try again in a moment.');
    case 'gemini_error':
      return out("Gemini couldn't handle that request. Please try again.");
    case 'cohere_quota':
      return out('Anchor is busy right now. Wait a minute and try again.');
    case 'cohere_error':
    case 'rerank_unavailable':
      return out("Part of Anchor's search isn't available right now. Please try again in a moment.");
    case 'rate_limited': {
      const what = upload ? 'uploads' : 'questions';
      if (body.scope === 'day') return out(`You've reached today's limit for ${what} on this site. Please try again tomorrow.`);
      const wait = body.retryAfterSec ? `about ${body.retryAfterSec} seconds` : 'a minute';
      return out(`That's a lot of ${what} in a short time. Wait ${wait} and try again.`);
    }
    case 'cohere_budget':
      return out("Anchor has reached its search limit for today. Please try again tomorrow.");
    case 'query_too_long':
      return out('That question is too long. Please keep it under 1,000 characters.');
    case 'too_many_documents':
      return out(err.message || 'You have the maximum number of documents. Remove one to add another.');
    case 'upload_in_progress':
      return out('Another upload is still running. Wait for it to finish, then try again.');
    case 'unsupported_file':
      return out('Only PDF, .txt and .md files can be added.');
    case 'too_many_pages':
    case 'too_many_chunks':
      return out(err.message || 'That document is too long. Split it into smaller files.');
    case 'bad_pdf':
      return out("That PDF couldn't be opened. It may be damaged or password-protected.");
    case 'file_too_large':
      return out('That file is too big. Files can be up to 25 MB.');
    case 'no_text':
      return out("I couldn't read any text in that file. Scanned PDFs (photos of pages) don't work yet.");
    case 'not_found':
      return out("The original file isn't saved for this document. Upload it again to see its pages.");
    default:
      return out(GENERIC);
  }
}

// Citations grouped into the pages they point to, in reading order, for the line of
// page chips under an answer. Each page keeps its first passage (opened on click) and
// the citation numbers that land on it. multiDoc says whether chips need the file name.
export function citedPages(citations = []) {
  const byPage = new Map();
  for (const c of citations) {
    const key = `${c.docName}\u0000${c.page}`;
    const entry = byPage.get(key) ?? { docName: c.docName, page: c.page, first: c, numbers: [] };
    entry.numbers.push(c.n);
    byPage.set(key, entry);
  }
  const pages = [...byPage.values()].sort((a, b) => a.docName.localeCompare(b.docName) || a.page - b.page);
  return { multiDoc: new Set(pages.map((p) => p.docName)).size > 1, pages };
}
