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
| `GEMINI_API_KEY` | yes | embeddings, reformulation, answers, eval judge |
| `GEMINI_MODEL` | no | generation model (default `gemini-2.5-flash`) |
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

**Retrieval parameters** shared by `/api/search/*` and `/api/ask`:
`query` (required), `k` (1-50, default 5), `docIds` (restrict to these documents),
`candidates` (pool per retriever before fusion/rerank, k-250, default 50).

### Documents

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/documents` | multipart `file` (PDF, .txt, .md; max 25 MB) | `{ docId, docName, pages, chunks, failed }` |
| POST | `/api/documents/text` | `{ name, text }` | same |
| GET | `/api/documents` | | `[{ docId, docName, pages, chunks, source?, uploadedAt? }]` |
| DELETE | `/api/documents/:docId` | | Typesense delete result |

### Search (retrieval only)

| Path | Extra body fields | Notes |
|---|---|---|
| `/api/search/dense` | | baseline 1 |
| `/api/search/keyword` | `engine`: `bm25` (default) or `typesense` | |
| `/api/search/hybrid` | `weights`: `{ keyword, dense }` (default 0.5/0.5) or `"auto"`; `rerank`: bool | baseline 2; `trace` has keyword/dense/fused/rerank lists and `routing` |
| `/api/search/anchor` | `weights` (default `"auto"`), `threshold` (0-1, default 0.3), `maxRetries` (0-3, default 2) | adds `confidence`, `retries`, `bestAttempt`, `attempts[]` (each with query, weights, hits, trace) |

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
  "invalidCitations": 0,
  "retrieval": { "confidence": { "topScore": 0.92, "threshold": 0.3, "confident": true }, "retries": 0, "attempts": [/* … */] },
  "latencyMs": 2855, "timings": { "retrievalMs": 891, "generateMs": 1963 }
}
```

When abstaining: `abstained: true`, `answer: null`, `citations: []`, and `abstainReason` is
`low_retrieval_confidence` (anchor only; Gemini is not called) or `not_in_passages`.
Baseline modes have `retrieval.confidence: null`. Follow-up questions are answered
standalone; chat history is stored, not used as context.

### Chats (need `MONGODB_URI`, else 503)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/chats` | `[{ chatId, title, messages, updatedAt }]`, newest first |
| GET | `/api/chats/:chatId` | messages, oldest first |
| DELETE | `/api/chats/:chatId` | `{ deleted }` |

### Health

`GET /api/health` → `{ ok, typesense, mongo }`, 503 if a configured service is down.

## Evaluation

See [eval/README.md](eval/README.md): retrieval runs (`npm run eval`), answer runs
(`npm run eval:answers`), and Markdown tables for the paper (`npm run eval:report`).

## Deployment

- **Render** (web service): root `server`, build `npm install`, start `npm start`. Not
  Vercel: uploads and embedding exceed serverless body and time limits.
- **Typesense Cloud** or a Docker service with a persistent disk; set the `TYPESENSE_*` vars.
- **MongoDB Atlas**: set `MONGODB_URI`.
- Set `CORS_ORIGIN` to the Vercel client URL. Keys only in env vars, never committed.
- The BM25 index lives in memory per server instance and rebuilds from Typesense on the
  first query after a restart or upload, so run a single instance.
