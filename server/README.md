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
| `EMBED_PACING` | no | default on: uploads stay inside the embedding model's per-minute limits and wait out a per-minute 429 (see Uploads and the embedding limits); `false` = batches back to back, a 429 fails the upload |
| `GEMINI_EMBED_RPM` / `GEMINI_EMBED_TPM` | no | per-minute request and token limits uploads are paced to; defaults 100 / 30000 (free tier) |
| `EVIDENCE_GATE` | no | default off; `true` = the evidence gate decides instead of the fixed threshold (needs the coefficients file, see Evidence gate) |
| `GATE_COEFFICIENTS` | no | path of the coefficients file (default `server/data/gate-coefficients.json`, written by `eval/fit-gate.js`) |
| `GATE_LOW` / `GATE_HIGH` | no | the gate's zone cut-offs, default 0.3 / 0.7 (provisional, not tuned) |
| `GATE_SUFFICIENCY` | no | default on; `false` = no Gemini call in the gate's middle zone (it then counts as not confident) |
| `FUSION` | no | `rrf` (default) or `convex` |
| `FUSION_ALPHA` | no | convex fusion's weight of the vector score, 0-1, default 0.5 (a placeholder until `eval/alpha-search.js` is run) |
| `USAGE_TRACKING` | no | default on: counts what each key uses through this server for `GET /api/gemini/usage`; `false` = nothing counted or stored |
| `GEMINI_EMBED_RPD`, `GEMINI_TEXT_RPM`, `GEMINI_TEXT_RPD` | no | limits shown next to the usage counts (they limit nothing): defaults 1000, 5, 20 |
| `COHERE_API_KEY` | for rerank/anchor | trial keys: 10 calls/min |
| `COHERE_RERANK_MODEL` | no | default `rerank-v3.5` |
| `CONFIDENCE_SIGNALS` | no | default on; `false` = no per-attempt confidence signals computed, returned or logged (the behaviour before they existed) |
| `SHARED_DOCUMENTS` | no | default off: documents belong to the key that uploaded them (see Documents); `true` = one library shared by every visitor, as before owners existed |
| `TYPESENSE_HOST/PORT/PROTOCOL/API_KEY` | yes | |
| `TYPESENSE_COLLECTION` | no | default `chunks`; lets a second deployment or a test use its own collection on the same Typesense |
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
| evidence gate on, with the sufficiency check | 1 more for each attempt that lands in the middle zone | 0 more |
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
| GET | `/api/documents` | | the caller's documents: `[{ docId, docName, pages, chunks, source?, uploadedAt? }]` |
| GET | `/api/documents/:docId/file` | | the original upload (PDF or text), for the source viewer; 404 `not_found` if uploaded before originals were stored |
| DELETE | `/api/documents/:docId` | | Typesense delete result (also deletes the stored original) |

Uploads strip running PDF headers/footers before chunking, and keep the original file
(MongoDB GridFS, or `server/uploads/` without MongoDB).

**Documents are per key.** Every document belongs to the Gemini key that uploaded it: its
chunks carry `owner`, the same short SHA-256 hash of the key that scopes chats (the key
itself is never stored). All five routes above therefore need `X-Gemini-Key` (the list,
file and delete routes make no Gemini call; the key only says whose documents these are),
and so does `/api/search/keyword`. A key lists, searches, opens and deletes only its own
documents: `docIds` in a search or ask request are narrowed to the caller's documents in one
place (`route()` in `routes/common.js`, logic in `lib/scope.js`), an empty `docIds` means
"all of mine", and another key's document answers 404 like one that doesn't exist.
Documents indexed before owners existed have no owner and stay visible to every key. A
visitor who switches to another key starts with an empty library. `SHARED_DOCUMENTS=true`
restores the single shared library. An existing collection gets the `owner` field added
on the next start; nothing is re-indexed.

### Search (retrieval only)

| Path | Extra body fields | Notes |
|---|---|---|
| `/api/search/dense` | | baseline 1 |
| `/api/search/keyword` | `engine`: `bm25` (default) or `typesense` | |
| `/api/search/hybrid` | `weights`: `{ keyword, dense }` (default 0.5/0.5) or `"auto"`; `rerank`: bool; `fusion`, `alpha` | baseline 2; `trace` has keyword/dense/fused/rerank lists, `routing` and `fusion` |
| `/api/search/anchor` | `weights` (default `"auto"`), `threshold` (0-1, default 0.15), `maxRetries` (0-3, default 1); `fusion`, `alpha`; `gate`, `gateLow`, `gateHigh`, `sufficiencyCheck` | adds `confidence`, `retries`, `bestAttempt`, `attempts[]` (each with query, weights, hits, trace, signals, and `gate` when the gate judged it) |

### Fusion: RRF or convex combination

`fusion: "rrf"` (default) merges the BM25 and vector lists by rank with weighted
reciprocal rank fusion. `fusion: "convex"` merges their scores instead (lib/fusion.js):
each list is min-max normalised over its candidates, then
`score = alpha * vector + (1 - alpha) * BM25`; a passage missing from a list scores 0
there, and so does the last passage of a list. `alpha` is one fixed number (0 = BM25
only, 1 = vectors only), so convex fusion uses neither `weights` nor query routing; the
response reports `weights: { keyword: 1 - alpha, dense: alpha }` and
`trace.fusion: { method, alpha }`. Defaults come from `FUSION` and `FUSION_ALPHA`; a
request's `fusion` / `alpha` override them, also on `/api/ask`. Pick alpha with
`eval/alpha-search.js`; 0.5 is a placeholder, and nothing has been measured yet.

### Evidence gate

Off by default. With `gate: true` (or `EVIDENCE_GATE=true`) and a coefficients file,
each Anchor attempt is judged by the gate (lib/gate.js) instead of `topScore >= threshold`:

1. The attempt's confidence signals become one probability through a logistic
   regression: `sigmoid(intercept + sum(weight * (feature - mean) / std))`, features in
   the order `topScore, top2Gap, top3Mean, overlap10 / 10, topInBoth` (a missing gap
   counts as 0, a missing top-3 mean as the top score).
2. The probability falls in a zone: `>= gateHigh` **high**: confident, answer;
   `< gateLow` **low**: not confident, retry if retries are left;
   in between **middle**: one Gemini request (lib/sufficiency.js, on the rewrite model)
   asks whether the passages are sufficient to answer; confident only if it says yes.
   With `sufficiencyCheck: false` the middle zone counts as not confident and costs no call.
3. A confident attempt ends the retry loop and is used. Otherwise the attempt with the
   highest probability is used and is not confident.

`confidence.gate` reports what decided: `{ used: true, probability, zone, sufficient,
low, high, sufficiencyCheck }`, or `{ used: false, reason }` when the threshold decided
after all: `no_coefficients` (the file is missing or invalid) or `no_signals`
(`CONFIDENCE_SIGNALS=false`). The file is re-read when it changes.

On `/api/ask`, an active gate (on and with a file) makes `strict` default to `true`: a
question the gate does not accept abstains with `low_retrieval_confidence`. Send
`strict: false` to keep answering with `lowConfidence: true`. The simple client sends
neither, so turning the gate on makes it abstain where the gate says so.

The coefficients come from `eval/fit-gate.js` (tuning split only). The cut-offs 0.3 /
0.7 are provisional. Nothing about the gate has been measured on real data yet: the
logic is covered by unit tests with fake search, a fake sufficiency check and a
hand-made model.

### Confidence signals (logged; the evidence gate's inputs)

Every reranked retrieval (each Anchor attempt, and `/api/search/hybrid` with
`rerank: true`) carries `signals` (lib/signals.js):

| Field | Meaning |
|---|---|
| `topScore` | top rerank score (0 when nothing was retrieved) |
| `top2Gap` | 1st minus 2nd rerank score; `null` with fewer than two reranked passages |
| `top3Mean` | mean of the top 3 rerank scores (of the 1 or 2 there are, if fewer) |
| `overlap10` | passages in both the BM25 top 10 and the vector top 10 (0-10) |
| `topInBoth` | whether the top reranked passage is in both of those top-10 lists |

The reranker is asked for at least 3 passages even when `k` is smaller (same single
Cohere call), so the signals don't depend on `k`; the response still has the top `k`.
`/api/ask` stores them per attempt in the `messages` collection as
`attempts: [{ attempt, query, signals }]` with `bestAttempt` (`attempts` is empty for
`dense`, plain `hybrid` and whole-document questions: no rerank, no scores). The eval
runners store the same rows (see eval/README.md). Unless the evidence gate is on, the
confidence check uses `topScore` against `threshold` only. `CONFIDENCE_SIGNALS=false`
turns all of this off, and with it the gate (it has nothing to read).

### Uploads and the embedding limits

An upload embeds every chunk with `gemini-embedding-001`. Its free tier allows 100
requests and 30,000 tokens per minute and 1,000 requests per day (the project owner's
AI Studio figures, Nov 2026). Chunks go in batches of up to 100, so a document over
about 100 chunks used to send a second batch within the same minute, get a 429, and
lose the batches already embedded. With pacing (lib/embed.js, lib/pace.js):

- batches are sized to 100 texts and 80% of the token limit (tokens are estimated at
  4 characters each, not measured), and each batch waits until the last minute's usage
  for that key leaves room; every text is counted as one request
- a batch refused by a per-minute limit waits the delay Gemini returns (60 s if none)
  and is sent again, up to 3 times; earlier batches are kept
- a daily limit or any other error fails the upload at once
- question embeddings are counted in the same per-key budget but never wait

So a large document takes roughly one minute per 100 chunks, and the request stays
open that long. Pacing state is in memory per server process. Measured so far: unit
tests with a fake client and clock only; no large upload has been run against Gemini.

### Ask (retrieval + answer)

`POST /api/ask` with the retrieval parameters plus `mode` (`anchor` default, `dense`,
`hybrid`), `chatId` (optional; generated if absent), `fusion` / `alpha`, and for anchor
`weights`, `threshold`, `maxRetries`, `strict` and the gate options (`gate`, `gateLow`,
`gateHigh`, `sufficiencyCheck`).

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

### Key usage (an estimate)

`GET /api/gemini/usage` (with `X-Gemini-Key`; no Gemini call) returns what that key has
used through this server, next to the configured limits:

```jsonc
{ "enabled": true, "estimate": true, "day": "2026-11-10", "resetsInSec": 79670, "persisted": true,
  "models": [{ "model": "gemini-embedding-001", "kind": "embedding",
    "limits": { "requestsPerMinute": 100, "tokensPerMinute": 30000, "requestsPerDay": 1000 },
    "minute": { "requests": 54, "tokens": 12000 }, "today": { "requests": 212, "tokens": 50000 },
    "limited": null }] }
```

It lists the embedding model, the caller's answer model and every model used today.
Google offers no way to read a key's limits or remaining quota, so this is not the key's
real state: use of the same key elsewhere (AI Studio, the eval judge) is not seen, and
the limits are configured defaults. Text models all show one default (5 a minute, 20 a
day, the free tier noted for the default answer model). Embedding requests count one
per text and their tokens are estimated; text requests use the token count Gemini
returns. `limited` is set when Google refused a request for that model, until the wait
it gave is over. Days follow Google's quota day (midnight Pacific). Daily counts are
stored in MongoDB (`usage`, one document per key hash, model and day; the key itself is
never stored) and survive a restart; the last minute and `limited` are in memory only.
`persisted: false` means MongoDB was not available and the counts started with the process.

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
  Vercel: uploads and embedding exceed serverless body and time limits. `render.yaml`
  in this folder is a Blueprint for it (New > Blueprint, Blueprint path
  `server/render.yaml`); Render asks for the secret values on the first deploy.
- **Typesense Cloud** or a Docker service with a persistent disk; set the `TYPESENSE_*` vars.
- **MongoDB Atlas**: set `MONGODB_URI`.
- Set `REQUIRE_USER_KEY=true` and leave `GEMINI_API_KEY` unset, so the server never
  spends its own quota. Set `CORS_ORIGIN` to the Vercel client URL. Server keys (Cohere,
  Typesense, MongoDB) only in env vars, never committed.

Environment for the deployed server (everything not listed keeps its default: upload
pacing on, confidence signals on, usage tracking on, evidence gate off, RRF fusion,
per-key documents):

```
REQUIRE_USER_KEY=true
COHERE_API_KEY=...
TYPESENSE_HOST=xxx.a1.typesense.net
TYPESENSE_PORT=443
TYPESENSE_PROTOCOL=https
TYPESENSE_API_KEY=...            # the cluster's admin key (the server creates the collection)
MONGODB_URI=mongodb+srv://...
MONGODB_DB=anchor_prod           # apart from the local / evaluation database
CORS_ORIGIN=https://<your-app>.vercel.app
```

Do not copy `EMBED_PACING=false` or `CONFIDENCE_SIGNALS=false` from a local `.env`, and do
not set `GEMINI_API_KEY`, `SHARED_DOCUMENTS` or `PORT` (Render provides the port).
- Visitors' keys travel in a header on every request, so the deployed API must be HTTPS
  (Render is by default).
- The BM25 index lives in memory per server instance and rebuilds from Typesense on the
  first query after a restart or upload, so run a single instance.
