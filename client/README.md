# Anchor client

Next.js UI for the Anchor server: a landing page and the chat workspace (rail, chat,
documents), with the earlier three-panel view with the retrieval trace behind a flag.

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL, default http://localhost:4000
npm install
npm run dev                  # http://localhost:3000 (the server must be running)
```

The server's `CORS_ORIGIN` must include this app's origin (`http://localhost:3000` locally,
the Vercel URL in production).

## Look and screens

One look across the whole site: a grey-blue to peach page gradient, one translucent rounded
"shell" holding each screen, white cards, ink-black pill buttons and an iridescent spark.
All of it comes from the tokens in `app/globals.css` (colours, radii, shadows as Tailwind 4
theme variables; light and dark via `prefers-color-scheme` plus the toggle in
`components/ui/ThemeToggle.js`). Components use token classes only (`bg-surface`,
`text-muted`, `bg-primary`…), never fixed colours, so both themes follow.

- `/` landing (`app/page.js`): spark, headline, a static copy of the chat screen
  (`components/landing/AppPreview.js`, same tokens as the real one), "How it works" with the
  animated `HeroIllustration`, "Why Anchor", "Under the hood" (the pipeline in plain words),
  closing call. "Get started" leads to `/chat`.
- `/chat` (`app/chat/page.js`): the key screen (`KeyGate`), then the workspace.

## Flow (at /chat)

Three parts inside the shell (`components/Workspace.js`):

1. **Rail** (`Sidebar`, left): Ask, Settings, Key usage, links back to the landing page, and
   a card for the key in use (last four characters, "Use a different key"). Below 1024 px it
   is a row of tabs at the top.
2. **Ask** (`Chat`, centre): a welcome screen with three cards. With no document ticked
   they are Upload / Paste text / How it works; otherwise they start a question in the box
   (Summarise, List the topics, Find a detail) without sending it, because every question
   uses the visitor's quota. The question box has Attach (upload), the answer-model picker
   and Settings. Answers (Markdown) carry numbered citations and a line of page chips;
   clicking either opens that page in a drawer with the passage highlighted (pdf.js). "Why
   this answer?" under each answer is closed by default and lists the supporting passages.
3. **Documents** (`DocPanel`, right from 1280 px; a screen of its own below that): tick the
   documents a question should search, search them by name, upload a PDF/txt/md, paste
   text (the round button), remove.
4. **Abstention**: every abstention reason shows the same sentence, "I couldn't find this
   in your document."
5. **Settings** (`SettingsView`), everything the ask screen hides:
   - "Show retrieval details" (off by default): adds a closed "Retrieval details" under
     each answer and abstention with the classic trace (retry path, routing weights and
     reasons, BM25 and semantic top 5, RRF fusion, rerank scores, confidence vs
     threshold, what Gemini read), plus the model and the abstention reason
   - Retrieval settings from the classic view: mode, k, and for Anchor the confidence
     threshold, strict and retries, with "Reset"; a "settings changed" badge when they
     differ from the defaults
   - Answer model, rewrite model, change key
6. **Key usage** (`Usage`): what the key has used through Anchor next to its limits.

With the details off, the ask screen shows no scores, weights, thresholds or retry
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
Set the variable in `.env.local` and restart; it is read at build time. It keeps its own
fixed light colours whatever the theme (`data-theme="light"` on its wrapper).

## Tests

```bash
npm test    # node --test: plain-words errors, page grouping, default model, settings
```

## Files

- `app/page.js`: landing page
- `app/chat/page.js`: key screen, then the workspace (or the classic one)
- `app/globals.css`: design tokens, page gradient, spark animation
- `lib/api.js`: fetch wrapper that adds the `X-Gemini-*` headers and turns server errors
  (`{ error, message }`) into `ApiError`
- `lib/plain.js`: abstention sentence, error code -> plain sentence, citations -> pages
- `lib/models.js`: default answer model
- `lib/settings.js`: retrieval defaults, `/api/ask` body, remembered Advanced choices
- `lib/highlight.js`: finds the pdf.js text items of a cited passage on its page
- `components/`: `KeyGate`, `Workspace` (state and layout), `Sidebar`, `Chat`, `DocPanel`,
  `SettingsView`, `Usage`, `Answer`, `AnswerDetails`, `Trace` (shared with classic),
  `SourceDrawer`, `SourceViewer`, `Markdown`
- `components/ui/`: `Shell` (the translucent panel), `Spark`, `Iris` (gradient for icons),
  `Button`, `Logo`, `ThemeToggle`, `Reveal`, `Card`, `Stepper`
- `components/landing/`: `AppPreview`, `HeroIllustration`
- `components/classic/`: `Workspace`, `Chat`, `SettingsPanel`, `Thinking`
- `public/pdf.worker.min.mjs`: pdf.js worker, copied from `pdfjs-dist` by `postinstall`

## Deploy (Vercel)

Root directory `client`, set `NEXT_PUBLIC_API_URL` to the Render server URL, and add the
Vercel URL to the server's `CORS_ORIGIN`.
