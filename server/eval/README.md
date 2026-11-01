# Evaluation

## Run

```bash
npm run dev                                    # in another terminal
npm run eval -- eval/datasets/smoke.json --upload
npm run eval -- eval/datasets/smoke.json --configs dense,hybrid,hybrid+route,hybrid+rerank,anchor-noretry,anchor
npm run eval -- eval/datasets/smoke.json --configs anchor --threshold 0.15   # threshold sweep
```

`--upload` indexes any dataset document that isn't indexed yet. Each document must be
indexed exactly once (the runner refuses duplicates). `--rerank-delay` (default 6500 ms per
Cohere call) keeps a trial key under its 10 calls/min limit; use `--rerank-delay 0` with a
production key. Results go to `eval/results/<dataset>-<timestamp>.json`.

## Configurations (eval/configs.js)

Each adds one component to the previous: `dense`, `bm25`, `hybrid` (static 0.5/0.5),
`hybrid+route`, `hybrid+rerank`, `anchor-noretry` (route + rerank), `anchor-static`
(rerank + retry, no routing), `anchor` (everything). Default: `dense,hybrid,anchor`.

## Dataset format

```json
{
  "name": "mydocs",
  "docs": [{ "name": "report.pdf", "file": "../docs/report.pdf" }],
  "questions": [
    { "id": "q01", "category": "exact", "question": "...", "answerable": true,
      "gold": [{ "doc": "report.pdf", "page": 4 }], "answer": "reference answer" },
    { "id": "u01", "category": "unanswerable", "question": "...", "answerable": false }
  ]
}
```

- `gold` lists every page that contains the answer (page numbers as in the PDF viewer,
  starting at 1). A hit counts as relevant if its document and page match.
- `answer` isn't used by the retrieval metrics; it's for scoring generated answers later.
- Write questions before looking at what the system retrieves, and mix categories
  (exact terms, paraphrases, numbers, multi-document) so per-category results mean something.

## Metrics

- **Recall@k**: fraction of gold pages in the top k (answerable questions only)
- **MRR**: mean of 1 / rank of the first relevant hit
- **Latency**: server-side end-to-end ms (mean, p50, p95). Includes any rate-limit waits.
- Anchor configs only: **answeredRate** (answerable questions that passed the confidence
  check), **abstainRate** (unanswerable questions that failed it), **retryRate**, and
  **retryPrecision** (of answerable questions that retried, the share where the first
  attempt missed the gold page and the final result found it)
