# Anchor client

Next.js UI for the Anchor server: a simple two-panel view by default, the earlier
three-panel view with the retrieval trace behind a flag.

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL, default http://localhost:4000
npm install
npm run dev                  # http://localhost:3000 (the server must be running)
```

The server's `CORS_ORIGIN` must include this app's origin (`http://localhost:3000` locally,
the Vercel URL in production).

## Flow (simple view, the default)

One screen: documents on the left, chat on the right.

1. **Setup screen**: the visitor enters their Gemini key once per tab, with a "How to get
   a key" link. It is checked with `GET /api/gemini/models`. The key stays in
   `sessionStorage` for this tab only.
2. **Documents** (left): upload a PDF/txt/md or paste text; tick the documents a question
   should search; remove.
3. **Chat** (right): one question box. Answers (Markdown) carry numbered citations and a
   line of page chips; clicking either opens that page in a drawer with the passage
   highlighted (pdf.js). "Why this answer?" under each answer is closed by default and
   lists the supporting passages with their pages.
4. **Abstention**: every abstention reason shows the same sentence, "I couldn't find this
   in your document."
5. **Advanced** (left, collapsed), everything the main view hides:
   - "Show retrieval details" (off by default): adds a closed "Retrieval details" under
     each answer and abstention with the classic trace (retry path, routing weights and
     reasons, BM25 and semantic top 5, RRF fusion, rerank scores, confidence vs
     threshold, what Gemini read), plus the model and the abstention reason
   - Retrieval settings from the classic view: mode, k, and for Anchor the confidence
     threshold, strict and retries, with "Reset"; the summary says "(settings changed)"
     when they differ from the defaults
   - Answer model, rewrite model, change key

With the details off, the main view shows no scores, weights, thresholds or retry
counts. `lib/settings.js` builds the `/api/ask` body: `{ query, k, docIds, chatId }` plus
only the settings changed from the defaults, so otherwise the server's defaults (mode,
threshold, retries, soft gate) apply. The settings and the details toggle are remembered
in `localStorage` per browser; the key is not. Errors are mapped from the server's error codes to plain
sentences in `lib/plain.js`; the server's raw message is never shown.

## Classic view (`NEXT_PUBLIC_UI=classic`)

The earlier three-panel UI, kept for evaluation and demos: settings (mode, model, k,
threshold, strict, retries, rewrite model) and the right panel with the retrieval trace
(retry path, routing weights and reasons, BM25 and semantic top 5, RRF fusion, Cohere
rerank scores, confidence vs threshold, every passage Gemini read) and the source viewer.
Set the variable in `.env.local` and restart; it is read at build time.

## Tests

```bash
npm test    # node --test: plain-words errors, page grouping, default model, settings
```

## Files

- `app/page.js`: key gate, then the simple or classic workspace
- `lib/api.js`: fetch wrapper that adds the `X-Gemini-*` headers and turns server errors
  (`{ error, message }`) into `ApiError`
- `lib/plain.js`: abstention sentence, error code -> plain sentence, citations -> pages
- `lib/models.js`: default answer model
- `lib/settings.js`: retrieval defaults, `/api/ask` body, remembered Advanced choices
- `lib/highlight.js`: finds the pdf.js text items of a cited passage on its page
- `components/`: `KeyGate`, `Workspace` (state), `DocPanel`, `Advanced`, `Chat`, `Answer`,
  `AnswerDetails`, `Trace` (shared with classic), `SourceDrawer`, `SourceViewer`, `Markdown`
- `components/classic/`: `Workspace`, `Chat`, `SettingsPanel`, `Thinking`
- `public/pdf.worker.min.mjs`: pdf.js worker, copied from `pdfjs-dist` by `postinstall`

## Deploy (Vercel)

Root directory `client`, set `NEXT_PUBLIC_API_URL` to the Render server URL, and add the
Vercel URL to the server's `CORS_ORIGIN`.
