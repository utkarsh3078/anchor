# Anchor client

Minimal Next.js UI for the Anchor server.

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL, default http://localhost:4000
npm install
npm run dev                  # http://localhost:3000 (the server must be running)
```

The server's `CORS_ORIGIN` must include this app's origin (`http://localhost:3000` locally,
the Vercel URL in production).

## Flow

1. **Key screen**: the visitor enters their Gemini key. It is checked with
   `GET /api/gemini/models`, which also fills the model picker. The key stays in
   `sessionStorage` for this tab only.
2. **Left panel**: documents (checkbox = include in search, upload PDF/txt/md, paste text,
   delete) and settings (mode, answer model, k, and for Anchor the confidence threshold,
   retries and rewrite model).
3. **Center**: chat. Answers (Markdown) cite passages as numbered chips; clicking a chip
   or a source opens it in the Source tab. Abstentions say why. A Gemini quota error
   offers a model switch.
4. **Right panel**, two tabs:
   - **Retrieval trace**: the pipeline step by step (retry path, routing weights and
     reasons, BM25 and semantic top 5, RRF fusion, Cohere rerank scores, confidence vs
     threshold, and every passage Gemini read). Rows the answer cites are green; every row
     opens its source.
   - **Source**: the original PDF page rendered with pdf.js, the passage highlighted and
     scrolled into view; page navigation and "Open" for the full PDF. Pasted text shows
     with the passage marked. Documents uploaded before files were stored must be
     re-uploaded to view.

## Files

- `app/page.js`: key gate, then the workspace
- `lib/api.js`: fetch wrapper that adds the `X-Gemini-*` headers and turns server errors
  (`{ error, message }`) into `ApiError`
- `lib/highlight.js`: finds the pdf.js text items of a cited passage on its page
- `components/`: `KeyGate`, `Workspace` (state), `DocPanel`, `SettingsPanel`, `Chat`,
  `Markdown`, `Trace`, `SourceViewer`
- `public/pdf.worker.min.mjs`: pdf.js worker, copied from `pdfjs-dist` by `postinstall`

## Deploy (Vercel)

Root directory `client`, set `NEXT_PUBLIC_API_URL` to the Render server URL, and add the
Vercel URL to the server's `CORS_ORIGIN`.
