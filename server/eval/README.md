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

## Tuning and test halves

Anything that is tuned is fitted on the **tuning** half and reported on the **test**
half. `eval/split.js` deals the questions into the two halves, separately for each kind
(answerable or not, and category), by a hash of the question id, so the result is the
same on every run. Store it in the dataset so later additions can't move a question:

```bash
npm run eval:split -- eval/datasets/real.json            # show the halves
npm run eval:split -- eval/datasets/real.json --write    # store "split" on every question
```

`run.js` and `answers.js` take `--split tune|test|all` (default `all`) and record each
row's half. The order of work for the gate and the fusion alpha:

```bash
# 1. Tuning half: collect signals (no text generation, one Cohere call per question)
npm run eval -- eval/datasets/real.json --configs anchor-noretry --split tune
# 2. Fit the gate on those rows. Writes server/data/gate-coefficients.json. No API calls
npm run eval:fit-gate -- eval/datasets/real.json
# 3. Pick the convex-fusion alpha on the tuning half (one embedding per question)
npm run eval:alpha -- eval/datasets/real.json
# 4. Test half: the comparison
npm run eval -- eval/datasets/real.json --split test --alpha <best> \
  --configs hybrid,hybrid-convex,anchor-noretry,anchor,anchor-gate,anchor-gate+check
npm run eval:answers -- eval/datasets/real.json --split test --modes anchor,anchor-soft,anchor-gate,anchor-gate+check
# 5. Report on the test half (the default)
npm run eval:report -- --dataset real --out ../report-real.md --data ../report-real.json
```

`fit-gate.js` reads every finished retrieval run of the dataset in `eval/results/` (or
`--runs a.json,b.json`), keeps only attempts of tuning-half questions that have signals
and a gold label, counts an attempt logged by several configs once, and fits an
L2-regularised logistic regression (`--lambda`, default 1) with label = `goldRetrieved`.
It refuses a tuning set with a single class and warns below 20 examples. The numbers it
prints are training numbers, not results.

`alpha-search.js` fetches each tuning question's BM25 and vector candidate lists once
(`/api/search/keyword` and `/api/search/dense`, 50 candidates, as the server uses) and
fuses them locally for alpha = 0, 0.1, ..., 1 with the server's own fusion code. It
reports Recall@k and MRR per alpha, RRF 0.5/0.5 on the same lists as a reference, and
the best alpha (recall, then MRR, then nearest 0.5). It does not change any setting.

### Free tiers

The runners send `GEMINI_API_KEY` from `.env` as `X-Gemini-Key` and bypass the server
caches, so latencies are real calls. Progress is saved after every question; when a quota
runs out the run stops (at once for a daily quota) and prints a `--resume` command:

```bash
npm run eval:answers -- eval/datasets/real.json --model gemini-2.5-flash --judge-model gemini-2.5-flash-lite
# ...stopped by a daily quota. Next day, or with another model:
npm run eval:answers -- eval/datasets/real.json --resume eval/results/real-answers-<ts>.partial.json --model <other>
```

Answer rows record their model, and the report lists the models used per mode. A run that
mixes models should be reported as such, or rerun. If only the judge failed, `--resume`
re-grades the saved answer without asking again. Retrieval runs need Gemini text requests
only for anchor configs that retry (`anchor`, `anchor-static`); `--rewrite-model` points
those at another model's quota. Model names are the ids from `GET /api/gemini/models`.

`--upload` indexes any dataset document that isn't indexed yet. Each document must be
indexed exactly once (the runner refuses duplicates). `--rerank-delay` (default 6500 ms per
Cohere call) keeps a trial key under its 10 calls/min limit; use `--rerank-delay 0` with a
production key. Every run is saved to `eval/results/<dataset>-<kind>-<timestamp>.json` and,
when `MONGODB_URI` is set, to the `evalRuns` collection. The report reads MongoDB when
configured (`--source files` to force the JSON files).

Rows of reranked configs (`hybrid+rerank` and the anchor ones) and of anchor answer modes
also carry `attempts`: one entry per retrieval attempt with the query and its confidence
`signals` (`topScore`, `top2Gap`, `top3Mean`, `overlap10`, `topInBoth`; defined in the
server README). In retrieval runs each attempt has `goldRetrieved`: whether that attempt's
own hits contain a gold page (always false for unanswerable questions). These are logged
for fitting a gate later; no metric or report table uses them yet. A server started with
`CONFIDENCE_SIGNALS=false` logs `signals: null`.

The report's **confidence gate** table is computed from the `anchor-noretry`
first-attempt scores already recorded, so include `anchor-noretry` in a retrieval run to
pick a threshold without extra API calls. A live sweep is still needed to see how
retries change things at each threshold.

## Retrieval configurations (eval/configs.js)

Each adds one component to the previous: `dense`, `bm25`, `hybrid` (static 0.5/0.5),
`hybrid+route`, `hybrid+rerank`, `anchor-noretry` (route + rerank), `anchor-static`
(rerank + retry, no routing), `anchor` (everything). Default: `dense,hybrid,anchor`.

Alternatives to compare against those:

- `hybrid-convex`: `hybrid` with convex fusion instead of RRF (`--alpha`, else the
  server's `FUSION_ALPHA`); the row records the alpha used
- `anchor-gate`: `anchor` with the evidence gate instead of the threshold, no
  sufficiency check (the middle zone counts as not confident)
- `anchor-gate+check`: the same with the sufficiency check (one Gemini request per
  attempt in the middle zone)

Every config pins `fusion` and `gate` in its request, so the server's `FUSION` and
`EVIDENCE_GATE` settings can't change what a row means. The gate configs need the
coefficients file: without it the threshold decides, each row says `gate.used: false`,
and the summary's `gateUsed` is 0. Such a run is not a gate result.

## Answer modes (eval/answers.js)

`dense`, `hybrid` (no confidence gate: Gemini is the only abstention check),
`anchor-noretry`, `anchor`. Default: `dense,hybrid,anchor`. `--no-judge` skips grading.
Also `hybrid-convex`, `anchor-soft` (the UI default: answers below the threshold),
`anchor-gate` and `anchor-gate+check` (strict, like `anchor`). The coverage-risk curve
at answer level needs `anchor-soft`, because it answers whatever the gate would say.

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

Answer or abstain (report, per config or mode, on the chosen half):

- **Answer rate**: questions answered / all questions
- **Accuracy on answered**: correct answers / graded answers. An answer to an
  unanswerable question is wrong. In a retrieval run there is no answer, so the column
  is "gold page retrieved when answered", a proxy
- **Unanswerable rejected**: unanswerable questions not answered / unanswerable questions
- **False abstention**: answerable questions not answered / answerable questions
- **Coverage-risk curve**: questions ranked by a confidence score and answered at or
  above a cut-off; coverage = answered / all, risk = wrong / answered. Two scores are
  compared on the same questions: the top rerank score (the threshold; marked at 0.3
  and at the server default) and the gate's probability (marked at its cut-offs),
  recomputed in the report from the logged signals and the coefficients file. Sources:
  `anchor-soft` answer rows (true correctness) and `anchor-noretry` retrieval rows
  (proxy). **AURC** is the area under that curve, lower is better. `--data file.json`
  writes every point.

The report computes these on `--split test` by default. Runs made before rows recorded
their half are used whole, and the report says so.

The judge (eval/judge.js) is a Gemini model grading Gemini answers, which can be biased.
Check a random sample of its verdicts by hand and report the agreement rate in the paper.
