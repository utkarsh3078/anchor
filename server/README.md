# Anchor server

Express API for self-correcting retrieval-augmented Q&A over uploaded documents.

```
upload ─► pages ─► chunks ─► Gemini embeddings ─► Typesense
question ─► routing ─► BM25 + dense ─► weighted RRF ─► Cohere rerank ─► confidence check
              ▲                                                         │ low: reformulate, retry
              └─────────────────────────────────────────────────────────┘
          ─► Gemini answer with [n] citations, or abstain
```

## Setup

Requires Node 20+ and Docker.

```bash
docker run -d --name typesense -p 8108:8108 -v "$PWD/../ts-data:/data" \
  typesense/typesense:29.0 --data-dir /data --api-key=anchor-dev-key
docker run -d --name anchor-mongo -p 27017:27017 -v anchor-mongo-data:/data/db mongo:7.0   # optional
cp .env.example .env    # then fill in the keys
npm install
npm run dev             # http://localhost:4000
npm test                # unit tests, no services needed
```

Later sessions: `docker start typesense anchor-mongo`.

| Variable | Required | Notes |
|---|---|---|
| `REQUIRE_USER_KEY` | production: `true` | every Gemini call must use the visitor's own key |
| `GEMINI_API_KEY` | local only | fallback when no `X-Gemini-Key` is sent; eval scripts and judge |
| `GEMINI_MODEL` | no | default answer model when the client doesn't pick one (default `gemini-2.5-flash`) |
| `GEMINI_JUDGE_MODEL` | no | eval judge model (default: `GEMINI_MODEL`) |
| `COHERE_API_KEY` | for rerank/anchor | trial keys: 10 calls/min |
| `COHERE_RERANK_MODEL` | no | default `rerank-v3.5` |
| `TYPESENSE_HOST/PORT/PROTOCOL/API_KEY` | yes | |
| `MONGODB_URI` | no | enables chat history, document metadata, eval-run logs |
| `MONGODB_DB` | no | default `anchor` |
| `CORS_ORIGIN` | in production | comma-separated origins; unset allows all |
| `PORT` | no | default 4000 |

## API

All search modes return hits as `{ id, docName, page, text, score }` plus `latencyMs`.
Every error is `{ error: <code>, message }` with a matching HTTP status.

### Gemini key and models (bring your own key)

Visitors supply their own Gemini key; Cohere, Typesense and MongoDB stay server-side.
Routes that call Gemini (uploads, `/api/search/dense|hybrid|anchor`, `/api/ask`) and
`/api/chats` read these headers:

| Header | Meaning |
|---|---|
| `X-Gemini-Key` | the visitor's key (required when `REQUIRE_USER_KEY=true`). Held in memory only, never stored or logged; chats are tied to a short SHA-256 hash of it |
| `X-Gemini-Model` | answer model, e.g. `gemini-2.5-flash` (default `GEMINI_MODEL`) |
| `X-Gemini-Rewrite-Model` | model for query rewrites (default: the answer model). A different model uses a separate free-tier quota |
| `X-Anchor-No-Cache: 1` | skip caches (used by the eval runner) |

`GET /api/gemini/models` with `X-Gemini-Key` is the client's key gate: 200
`{ models: [{ id, displayName, inputTokenLimit }], defaultModel }` means the key works
(it lists models, a metadata call, not a generation request); 401 `gemini_key_invalid`
means ask for the key again.

| Error code | Status | Client should |
|---|---|---|
| `gemini_key_required` / `gemini_key_invalid` | 401 | show the key form |
| `gemini_quota` (`scope`: `minute` or `day`, `model`, `retryAfterSec`) | 429 | offer a model switch; for `minute`, or wait |
| `gemini_model_unavailable` | 400 | pick another model |
| `gemini_unavailable` | 503 | retry later |
| `cohere_quota` | 429 | retry later, or use mode `hybrid` (no rerank) |
| `bad_request`, `not_found`, `file_too_large`, `no_text` | 4xx | show the message |

### Gemini requests per action (free tiers count requests)

| Action | Text-generation requests | Embedding requests |
|---|---|---|
| Upload | 0 | 1 per 100 chunks |
| `/api/search/keyword` | 0 | 0 |
| `/api/search/dense`, `/hybrid`, `/anchor` with `maxRetries: 0` | 0 | 1 (cached per query text) |
| `/api/search/anchor` | 1 per retry (default max 1) | 1 per attempt |
| `/api/ask` mode `anchor` | 0 if retrieval abstains, else 1, plus 1 per retry | 1 per attempt |
| `/api/ask` mode `dense` / `hybrid` | 1 (0 if nothing retrieved) | 1 |

Identical requests are served from in-memory caches (query embeddings, rewrites, and
answers keyed by model + question + passages), so re-asking or switching UI mode back
costs nothing. Quota errors (429) are not retried, since a retry would only burn another request.

**Retrieval parameters** shared by `/api/search/*` and `/api/ask`:
`query` (required), `k` (1-50, default 5), `docIds` (restrict to these documents),
`candidates` (pool per retriever before fusion/rerank, k-250, default 50).

### Documents

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/documents` | multipart `file` (PDF, .txt, .md; max 25 MB) | `{ docId, docName, pages, chunks, failed }` |
| POST | `/api/documents/text` | `{ name, text }` | same |
| GET | `/api/documents` | | `[{ docId, docName, pages, chunks, source?, uploadedAt? }]` |
| GET | `/api/documents/:docId/file` | | the original upload (PDF or text), for the source viewer; 404 `not_found` if uploaded before originals were stored |
| DELETE | `/api/documents/:docId` | | Typesense delete result (also deletes the stored original) |

Uploads strip running PDF headers/footers before chunking, and keep the original file
(MongoDB GridFS, or `server/uploads/` without MongoDB).

### Search (retrieval only)

| Path | Extra body fields | Notes |
|---|---|---|
| `/api/search/dense` | | baseline 1 |
| `/api/search/keyword` | `engine`: `bm25` (default) or `typesense` | |
| `/api/search/hybrid` | `weights`: `{ keyword, dense }` (default 0.5/0.5) or `"auto"`; `rerank`: bool | baseline 2; `trace` has keyword/dense/fused/rerank lists and `routing` |
| `/api/search/anchor` | `weights` (default `"auto"`), `threshold` (0-1, default 0.15), `maxRetries` (0-3, default 1) | adds `confidence`, `retries`, `bestAttempt`, `attempts[]` (each with query, weights, hits, trace) |

### Ask (retrieval + answer)

`POST /api/ask` with the retrieval parameters plus `mode` (`anchor` default, `dense`,
`hybrid`), `chatId` (optional; generated if absent), and for anchor `weights`,
`threshold`, `maxRetries`.

```jsonc
{
  "chatId": "…", "mode": "anchor",
  "abstained": false,
  "answer": "The asset code of the backup chlorinator is CL-7Q [1].",
  "citations": [{ "n": 1, "id": "…", "docName": "plant-manual.pdf", "page": 2, "text": "…", "score": 0.92 }],
  "invalidCitations": 0, "model": "gemini-2.5-flash", "cached": false,
  "retrieval": { "confidence": { "topScore": 0.92, "threshold": 0.3, "confident": true }, "retries": 0, "attempts": [/* … */] },
  "latencyMs": 2855, "timings": { "retrievalMs": 891, "generateMs": 1963 }
}
```

`context` lists every passage Gemini read (`{ id, docName, page, text, neighbour }`): the
retrieved hits plus, for the top 4, the chunk before and after (`neighbours: false` turns
that off). Answers are Markdown (bold headings, `- ` bullets) with `[n]` citations into
`context`. The search `trace` includes `passages` (id → docName, page, text) for the top 10
of each stage.

When abstaining: `abstained: true`, `answer: null`, `citations: []`, and `abstainReason` is
`low_retrieval_confidence` (anchor only; Gemini is not called), `not_in_passages`, or
`no_passages` (nothing retrieved; Gemini is not called).
Baseline modes have `retrieval.confidence: null`. Follow-up questions are answered
standalone; chat history is stored, not used as context.

### Chats (need `MONGODB_URI`, else 503; scoped to the caller's key)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/chats` | `[{ chatId, title, messages, updatedAt }]`, newest first |
| GET | `/api/chats/:chatId` | messages, oldest first |
| DELETE | `/api/chats/:chatId` | `{ deleted }` |

### Health

`GET /api/health` → `{ ok, typesense, mongo, requireUserKey }`, 503 if a configured service is down.

## Evaluation

See [eval/README.md](eval/README.md): retrieval runs (`npm run eval`), answer runs
(`npm run eval:answers`), and Markdown tables for the paper (`npm run eval:report`).

## Deployment

- **Render** (web service): root `server`, build `npm install`, start `npm start`. Not
  Vercel: uploads and embedding exceed serverless body and time limits.
- **Typesense Cloud** or a Docker service with a persistent disk; set the `TYPESENSE_*` vars.
- **MongoDB Atlas**: set `MONGODB_URI`.
- Set `REQUIRE_USER_KEY=true` and leave `GEMINI_API_KEY` unset, so the server never
  spends its own quota. Set `CORS_ORIGIN` to the Vercel client URL. Server keys (Cohere,
  Typesense, MongoDB) only in env vars, never committed.
- Visitors' keys travel in a header on every request, so the deployed API must be HTTPS
  (Render is by default).
- The BM25 index lives in memory per server instance and rebuilds from Typesense on the
  first query after a restart or upload, so run a single instance.
