'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { FileSearch, Layers, ListChecks, MessageSquareQuote, RotateCw, Shapes, ThumbsDown, ThumbsUp, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { categoryName, duration, headline, pct, pipelineSteps } from '@/lib/results';
import { ratingsSummary } from '@/lib/feedback';
import Reveal from '@/components/ui/Reveal';
import Spark from '@/components/ui/Spark';
import Button from '@/components/ui/Button';
import { IrisIcon } from '@/components/ui/Iris';
import CountUp from './CountUp';
import Bars from './Bars';
import ThresholdChart from './ThresholdChart';

const section = 'mx-auto w-full max-w-5xl px-4 sm:px-8';
const card = 'rounded-card border border-border bg-surface p-5 shadow-soft sm:p-7';
const h2 = 'text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl';
const lead = 'mt-2 max-w-2xl leading-relaxed text-muted text-pretty';

const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const tileValue = (t) => (t.fraction
  ? (v) => `${Math.round(v * t.fraction[1])}/${t.fraction[1]}`
  : (v) => pct(v));

function Heading({ icon, title, children }) {
  return (
    <Reveal>
      <div className="flex items-center gap-3">
        <IrisIcon icon={icon} className="shrink-0" />
        <h2 className={h2}>{title}</h2>
      </div>
      <div className={lead}>{children}</div>
    </Reveal>
  );
}

function Search({ retrieval }) {
  const steps = pipelineSteps(retrieval.configs);
  const rows = steps.map((s) => ({
    key: s.config,
    label: s.label,
    note: [s.recallGain && `${s.recallGain} found`, s.mrrGain && `${s.mrrGain} ranking`].filter(Boolean).join(' · ') || null,
    values: { recall: s.recall, mrr: s.mrr },
  }));
  const r = retrieval.retries;
  return (
    <section aria-labelledby="search-title" className={`${section} py-12 md:py-16`}>
      <Heading icon={FileSearch} title={<span id="search-title">Finding the right page</span>}>
        Before Anchor writes an answer it has to find the page that holds it. The first two rows are the two kinds
        of search on their own; each row after that adds one part. The blue bar is how often the right page was in
        the top {retrieval.k} results; the orange bar is how close to the top it was (100% means always first).
      </Heading>
      <Reveal className={`${card} mt-6`}>
        <Bars
          caption="Search quality for each version of the search"
          rows={rows}
          format={(v) => pct(v)}
          series={[
            { key: 'recall', label: `Right page in the top ${retrieval.k}`, color: 'bg-viz-1' },
            { key: 'mrr', label: 'How near the top it was (MRR)', color: 'bg-viz-2' },
          ]}
        />
        {r && (
          <p className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-sm text-muted">
            <RotateCw className="mt-0.5 size-4 shrink-0" aria-hidden />
            {r.questions
              ? `Anchor reworded and retried ${r.questions} question${r.questions === 1 ? '' : 's'} whose first search looked weak; ${r.helped ? `${r.helped} of them found the right page that way` : 'none found a new right page that way'}.`
              : 'No question needed a retry.'}
          </p>
        )}
      </Reveal>
    </section>
  );
}

function ByDocument({ retrieval }) {
  if (!retrieval.byDocument.length) return null;
  const has = (c) => retrieval.configs.some((x) => x.config === c);
  const series = [
    has('dense') && { key: 'dense', label: 'Meaning search alone', color: 'bg-viz-1' },
    has('bm25') && { key: 'bm25', label: 'Keyword search alone', color: 'bg-viz-2' },
    has('hybrid') && { key: 'hybrid', label: 'Both combined', color: 'bg-viz-3' },
  ].filter(Boolean);
  return (
    <section aria-labelledby="docs-title" className={`${section} py-12 md:py-16`}>
      <Heading icon={Layers} title={<span id="docs-title">Two searches miss different things</span>}>
        Searching by meaning and searching by exact words each miss some pages, but rarely the same ones, so
        combining them finds more. Right page in the top {retrieval.k}, per document:
      </Heading>
      <Reveal className={`${card} mt-6`}>
        <Bars
          caption="Right page found per document, for each search alone and combined"
          rows={retrieval.byDocument.map((d) => ({ key: d.document, label: d.document, note: `${d.questions} questions`, values: d.recall }))}
          series={series}
          format={(v) => pct(v)}
        />
      </Reveal>
    </section>
  );
}

function Answers({ answers }) {
  const anchor = answers.modes.find((m) => m.mode === 'anchor-soft') ?? answers.modes[0];
  const base = answers.modes.find((m) => m !== anchor);
  const modes = [anchor, base].filter(Boolean);
  const series = modes.map((m, i) => ({ key: m.mode, label: m.label, color: i ? 'bg-viz-base' : 'bg-viz-1' }));
  const row = (key, label, note, get) => ({ key, label, note, values: Object.fromEntries(modes.map((m) => [m.mode, get(m)])) });
  const rows = [
    anchor.accuracy != null && row('accuracy', 'Answered correctly', `of ${anchor.answerable} questions with an answer in the documents`, (m) => m.accuracy),
    row('answered', 'Gave an answer', 'when the answer was in the documents', (m) => m.answered / m.answerable),
    m0(anchor) && row('refused', 'Said “not in your document”', `when it wasn’t (${anchor.unanswerable} questions)`, (m) => m.refused / m.unanswerable),
    row('cited', 'Cited a right page', 'out of the answers given', (m) => m.citedRightPage),
  ].filter(Boolean);
  return (
    <section aria-labelledby="answers-title" className={`${section} py-12 md:py-16`}>
      <Heading icon={MessageSquareQuote} title={<span id="answers-title">The answers</span>}>
        The same {answers.questions} questions went through the full Anchor pipeline and, for comparison, through a
        plain search without re-ranking or retries. Every answer was checked against a known correct answer.
      </Heading>
      <Reveal className={`${card} mt-6`}>
        <Bars caption="Answer quality, Anchor compared with plain search" rows={rows} series={series} format={(v) => pct(v)} />
        <p className="mt-5 border-t border-border pt-4 text-sm text-muted">
          Typical time per question: {modes.map((m) => `${m.label} ${duration(m.latencyP50)}`).join(', ')} (free-tier
          services, with calls spaced to stay inside their limits).
        </p>
      </Reveal>
    </section>
  );
}
const m0 = (m) => m.unanswerable > 0;

function Threshold({ retrieval }) {
  if (!retrieval.threshold.length) return null;
  return (
    <section aria-labelledby="cutoff-title" className={`${section} py-12 md:py-16`}>
      <Heading icon={ListChecks} title={<span id="cutoff-title">Knowing when to say “I couldn’t find it”</span>}>
        Anchor scores how well the best passage fits the question. A strict cut-off on that score would stop
        questions the documents can’t answer, but it would also stop some that they can. That is why Anchor keeps
        its cut-off low and lets the answer step refuse when the passages don’t contain the answer.
      </Heading>
      <Reveal className={`${card} mt-6`}>
        <ThresholdChart points={retrieval.threshold} current={retrieval.defaultThreshold} />
      </Reveal>
    </section>
  );
}

function ByType({ retrieval }) {
  const cfg = retrieval.configs.find((c) => c.config === 'anchor') ?? retrieval.configs.at(-1);
  if (!retrieval.byCategory.length) return null;
  return (
    <section aria-labelledby="types-title" className={`${section} py-12 md:py-16`}>
      <Heading icon={Shapes} title={<span id="types-title">By kind of question</span>}>
        Right page in the top {retrieval.k} with {cfg.config === 'anchor' ? 'the full Anchor search' : cfg.label}, by the kind of question asked.
      </Heading>
      <Reveal className={`${card} mt-6`}>
        <Bars
          caption={`Right page found by kind of question, ${cfg.label}`}
          rows={retrieval.byCategory.map((c) => ({ key: c.category, label: categoryName(c.category), note: `${c.questions} questions`, values: { v: c.recall[cfg.config] } }))}
          series={[{ key: 'v', label: 'Right page found', color: 'bg-viz-1' }]}
          format={(v) => pct(v)}
        />
      </Reveal>
    </section>
  );
}

// Visitor ratings ("Was this helpful?" in the chat). Opinion, not a measurement: shown as
// its own section, never folded into the measured numbers above.
function PeopleSay({ feedback }) {
  const reduce = useReducedMotion();
  const s = ratingsSummary(feedback);
  if (!s) return null;
  const share = s.rated ? s.helpful / s.rated : 0;
  return (
    <section aria-labelledby="people-title" className={`${section} py-12 md:py-16`}>
      <Heading icon={Users} title={<span id="people-title">What people say</span>}>
        People using Anchor can rate each answer with a thumbs up or down. This is their opinion, not a
        measurement: they usually don’t know the correct answer, so it doesn’t change any number above. Answers
        rated down are collected as new test questions instead.
      </Heading>
      <Reveal className={`${card} mt-6`}>
        {s.state === 'none' ? (
          <p className="text-muted">No answers have been rated yet. Rate answers in the chat with a thumbs up or down.</p>
        ) : (
          <>
            <p className="text-sm font-medium text-muted">Rated helpful</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <CountUp value={s.rate} format={(v) => pct(v, 0)} className="text-5xl font-semibold tracking-[-0.03em]" />
              <span className="text-muted">of {s.rated} rated answer{s.rated === 1 ? '' : 's'}</span>
            </p>
            <div
              className="mt-5 flex h-2 w-full max-w-xl gap-0.5 overflow-hidden rounded-full"
              role="img" aria-label={`${s.helpful} rated helpful, ${s.notHelpful} rated not helpful`}
            >
              {s.helpful > 0 && (
                <motion.span
                  className="h-full rounded-full bg-ok" style={{ width: `${share * 100}%`, transformOrigin: 'left' }}
                  initial={reduce ? false : { scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }}
                  transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                />
              )}
              {s.notHelpful > 0 && <span className="h-full flex-1 rounded-full bg-danger" />}
            </div>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-1.5"><ThumbsUp className="size-4 text-ok" aria-hidden /> {s.helpful} helpful</span>
              <span className="inline-flex items-center gap-1.5"><ThumbsDown className="size-4 text-danger" aria-hidden /> {s.notHelpful} not helpful</span>
            </p>
            {s.state === 'few' && <p className="mt-3 text-sm text-muted">Too few ratings to read much into yet.</p>}
          </>
        )}
        {s.refusals && <p className="mt-4 border-t border-border pt-4 text-sm text-muted">{s.refusals}</p>}
      </Reveal>
    </section>
  );
}

function Method({ results }) {
  const { dataset, retrieval, answers } = results;
  const dates = [...new Set([retrieval?.measuredAt, answers?.measuredAt].filter(Boolean).map(day))];
  const items = [
    dataset.questions && `${dataset.questions} questions (${dataset.answerable} with an answer in the documents, ${dataset.unanswerable} without), drafted with an AI assistant from the document text, each with a correct answer and the page it is on, before Anchor was run on them.`,
    dataset.documents.length && `${dataset.documents.length} documents searched together: ${dataset.documents.join(', ')}.`,
    answers?.gradedBy && `Answers were checked against the correct answers by an AI grader (${answers.gradedBy.replace(/\s*\(.*\)\s*$/, '')}), not by a person.`,
    answers?.models.length && `Answers were written by ${answers.models.join(', ')}.`,
    `With ${dataset.answerable ?? 'this many'} questions, one question moves a percentage by about ${dataset.answerable ? Math.round(1000 / dataset.answerable) / 10 : '2'} points, so small differences between versions are within chance.`,
    'This page reads the latest saved test run, so it changes when a new run is saved.',
  ].filter(Boolean);
  return (
    <section aria-labelledby="method-title" className={`${section} pb-16 pt-12 md:pb-24 md:pt-16`}>
      <Reveal className={card}>
        <h2 id="method-title" className="text-xl font-semibold">How this was measured</h2>
        {dates.length > 0 && <p className="mt-1 text-sm text-muted">Test run{dates.length > 1 ? 's' : ''}: {dates.join(' and ')}</p>}
        <ul className="mt-4 space-y-2.5 text-[15px] leading-relaxed">
          {items.map((t) => (
            <li key={t} className="relative pl-5 before:absolute before:left-1 before:top-[0.7em] before:size-[5px] before:rounded-full before:bg-subtle">{t}</li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}

// The results page: loads GET /api/results (totals of the latest saved test runs) and
// draws them. Numbers count up and bars grow as they scroll into view; every chart has a
// table view, and reduced motion shows everything at once.
export default function ResultsView() {
  const [state, setState] = useState({ status: 'loading' });

  const load = () => {
    setState({ status: 'loading' });
    api('/api/results')
      .then((results) => setState({ status: 'ready', results }))
      .catch((e) => setState({ status: e.code === 'not_found' ? 'empty' : 'error' }));
  };
  useEffect(load, []);

  if (state.status !== 'ready') {
    const text = {
      loading: 'Loading the latest test results…',
      empty: 'No test results have been saved yet.',
      error: 'The results couldn’t be loaded. The server may be waking up; this can take about a minute.',
    }[state.status];
    return (
      <div className={`${section} flex min-h-[50vh] flex-col items-center justify-center py-16 text-center`} role="status">
        <Spark className="size-20" busy={state.status === 'loading'} />
        <p className="mt-3 text-muted">{text}</p>
        {state.status === 'error' && <Button className="mt-4" onClick={load}>Try again</Button>}
      </div>
    );
  }

  const { results } = state;
  const tiles = headline(results);
  return (
    <>
      <section className={`${section} pb-6 pt-6 text-center sm:pt-10`}>
        <h1 className="mx-auto max-w-3xl text-[2.4rem] font-semibold leading-[1.05] tracking-[-0.035em] text-balance sm:text-6xl">
          How accurate is Anchor?
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-muted text-pretty">
          We asked it {results.dataset.questions ?? results.answers?.questions ?? results.retrieval?.questions} questions about{' '}
          {results.dataset.documents.length || 'several'} documents and checked every answer against the page it should come from.
        </p>
        <ul className="mt-10 grid gap-3 text-left sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((t, i) => (
            <Reveal as="li" key={t.key} delay={i * 0.08} className={`${card} flex flex-col`}>
              <p className="text-sm font-medium text-muted">{t.label}</p>
              <CountUp value={t.value} format={tileValue(t)} className="mt-2 text-5xl font-semibold tracking-[-0.03em]" />
              <p className="mt-2 text-sm leading-snug text-muted">{t.detail}</p>
            </Reveal>
          ))}
        </ul>
      </section>
      {results.retrieval && <Search retrieval={results.retrieval} />}
      {results.answers && <Answers answers={results.answers} />}
      {results.retrieval && <Threshold retrieval={results.retrieval} />}
      {results.retrieval && <ByDocument retrieval={results.retrieval} />}
      {results.retrieval && <ByType retrieval={results.retrieval} />}
      <PeopleSay feedback={results.feedback} />
      <Method results={results} />
    </>
  );
}
