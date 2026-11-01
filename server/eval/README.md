# Evaluation

## Run

```bash
npm run dev                                    # in another terminal

# Retrieval metrics
npm run eval -- eval/datasets/smoke.json --upload
npm run eval -- eval/datasets/smoke.json --configs dense,bm25,hybrid,hybrid+route,hybrid+rerank,anchor-noretry,anchor-static,anchor
npm run eval -- eval/datasets/smoke.json --configs anchor --threshold 0.1,0.2,0.3,0.4   # live sweep

# Answer metrics (through /api/ask, graded by an LLM judge)
npm run eval:answers -- eval/datasets/smoke.json --modes dense,hybrid,anchor

# Markdown tables for the paper from the latest runs
npm run eval:report -- --dataset smoke --out ../report-smoke.md
```

`--upload` indexes any dataset document that isn't indexed yet. Each document must be
indexed exactly once (the runner refuses duplicates). `--rerank-delay` (default 6500 ms per
Cohere call) keeps a trial key under its 10 calls/min limit; use `--rerank-delay 0` with a
production key. Every run is saved to `eval/results/<dataset>-<kind>-<timestamp>.json` and,
when `MONGODB_URI` is set, to the `evalRuns` collection. The report reads MongoDB when
configured (`--source files` to force the JSON files).

The report's **confidence gate** table is computed from the `anchor-noretry`
first-attempt scores already recorded, so include `anchor-noretry` in a retrieval run to
pick a threshold without extra API calls. A live sweep is still needed to see how
retries change things at each threshold.

## Retrieval configurations (eval/configs.js)

Each adds one component to the previous: `dense`, `bm25`, `hybrid` (static 0.5/0.5),
`hybrid+route`, `hybrid+rerank`, `anchor-noretry` (route + rerank), `anchor-static`
(rerank + retry, no routing), `anchor` (everything). Default: `dense,hybrid,anchor`.

## Answer modes (eval/answers.js)

`dense`, `hybrid` (no confidence gate: Gemini is the only abstention check),
`anchor-noretry`, `anchor`. Default: `dense,hybrid,anchor`. `--no-judge` skips grading.

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

Answer runs:

- **Accuracy**: answerable questions the judge marks `correct` vs the reference answer
  (abstaining counts as wrong)
- **Answered / abstained**: answerable questions answered, unanswerable questions abstained
- **Citation precision**: share of an answer's citations on a gold page; **cited gold**:
  at least one citation on a gold page
- **Faithfulness**: judge's verdict on whether the answer is supported by the passages it
  cites (`supported` / `partial` / `unsupported`)

The judge (eval/judge.js) is a Gemini model grading Gemini answers, which can be biased.
Check a random sample of its verdicts by hand and report the agreement rate in the paper.
