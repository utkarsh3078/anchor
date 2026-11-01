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
3. **Center**: chat. Answers cite passages as numbered chips; click one to read the source
   passage. Abstentions say why. A Gemini quota error offers a model switch.
4. **Right panel**: retrieval trace for the selected answer: confidence vs threshold,
   each attempt's query, routing weights and reasons, and the passages used.

## Files

- `app/page.js`: key gate, then the workspace
- `lib/api.js`: fetch wrapper that adds the `X-Gemini-*` headers and turns server errors
  (`{ error, message }`) into `ApiError`
- `components/`: `KeyGate`, `Workspace` (state), `DocPanel`, `SettingsPanel`, `Chat`, `Trace`

## Deploy (Vercel)

Root directory `client`, set `NEXT_PUBLIC_API_URL` to the Render server URL, and add the
Vercel URL to the server's `CORS_ORIGIN`.
