import {
  ArrowDown, ArrowRight, FileText, KeyRound, MessageCircleQuestion, Quote, SearchX, ShieldCheck, Sparkles,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Logo from '@/components/ui/Logo';
import Shell from '@/components/ui/Shell';
import Spark from '@/components/ui/Spark';
import ThemeToggle from '@/components/ui/ThemeToggle';
import Reveal from '@/components/ui/Reveal';
import { IRIS, IrisIcon } from '@/components/ui/Iris';
import AppPreview from '@/components/landing/AppPreview';
import HeroIllustration from '@/components/landing/HeroIllustration';

// Where "Get started" leads: the key screen, then the chat
const START = '/chat';

const NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#why', label: 'Why Anchor' },
  { href: '#inside', label: 'Under the hood' },
];

const STEPS = [
  { icon: KeyRound, title: 'Add your key', text: 'Paste a key from Google so Anchor can read your files and write answers. Google offers a free one.' },
  { icon: FileText, title: 'Upload a document', text: 'Add a PDF or a notes file. Anchor reads it page by page.' },
  { icon: MessageCircleQuestion, title: 'Ask questions', text: 'Ask in your own words. Every answer shows the page it came from.' },
];

// Each line is something the code does, not a measured result
const REASONS = [
  { icon: Quote, title: 'Answers show their page', text: 'Answers point to the page they came from. Click the page to read the exact passage yourself.' },
  { icon: SearchX, title: 'It tells you when it can’t find it', text: 'If your files don’t cover a question, Anchor is built to say “I couldn’t find this” rather than guess.' },
  { icon: ShieldCheck, title: 'Your key stays with you', text: 'Your key is kept in your browser tab and sent only with your requests. Anchor’s server doesn’t save it.' },
];

// What the server does with a question, in order (the pipeline in plain words)
const INSIDE = [
  { title: 'Reads page by page', text: 'Your file is cut into short passages that remember their page.' },
  { title: 'Searches two ways', text: 'By the exact words and by the meaning, then merges both lists.' },
  { title: 'Re-ranks', text: 'A second model re-orders the passages by how well they fit your question.' },
  { title: 'Checks the evidence', text: 'If the best passage looks weak, it rewords the question and searches again.' },
  { title: 'Answers with pages', text: 'The answer is written only from those passages and points to their pages.' },
];

const section = 'mx-auto w-full max-w-6xl px-4 sm:px-8';
const h2 = 'text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl';
const cardBase = 'rounded-card border border-border bg-surface p-6 shadow-soft';

export default function Landing() {
  return (
    <div className="p-2 sm:p-3 lg:p-5">
      <Shell className="mx-auto max-w-[1560px] overflow-hidden">
        <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-8 sm:py-5">
          <Logo />
          <nav aria-label="Sections" className="hidden items-center gap-1 rounded-full border border-border bg-surface/70 p-1 text-sm lg:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="rounded-full px-4 py-1.5 text-muted transition-colors duration-200 hover:bg-surface hover:text-fg">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Button href={START} size="sm">Get started</Button>
          </div>
        </header>

        <main>
          {/* Hero: the same spark and headline style as the chat's first screen */}
          <section className={`${section} pb-14 pt-6 text-center sm:pt-10 md:pb-20`}>
            <Spark className="mx-auto size-24 sm:size-32" />
            <p className="mx-auto mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-medium shadow-soft">
              <Sparkles className="size-4" color={IRIS} aria-hidden /> Answers that show their page
            </p>
            <h1 className="mx-auto mt-5 max-w-5xl text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.035em] text-balance sm:text-6xl md:text-[4.25rem]">
              Ask your documents. <br className="hidden lg:block" />
              Get answers you can check.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted text-pretty">
              Upload a PDF or notes, ask anything, and Anchor answers using only what’s in your files, with the
              page number to prove it.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button href={START} size="lg">
                Get started <ArrowRight className="size-4" aria-hidden />
              </Button>
              <Button href="#how" variant="secondary" size="lg">
                See how it works <ArrowDown className="size-4" aria-hidden />
              </Button>
            </div>

            <Reveal className="mt-12 md:mt-14">
              <AppPreview />
              <p className="mt-3 text-sm text-muted">An example screen. Your answers come from your own files.</p>
            </Reveal>
          </section>

          {/* How it works */}
          <section id="how" aria-labelledby="how-title" className="scroll-mt-6 border-t border-border">
            <div className={`${section} grid items-center gap-10 py-16 md:grid-cols-2 md:gap-14 md:py-24`}>
              <div>
                <Reveal>
                  <h2 id="how-title" className={h2}>How it works</h2>
                  <p className="mt-3 text-lg text-muted">From a file to an answer you can check.</p>
                </Reveal>
                <ol className="mt-8 space-y-3">
                  {STEPS.map(({ icon, title, text }, i) => (
                    <Reveal as="li" key={title} delay={i * 0.08} className={`${cardBase} flex gap-4 p-5`}>
                      <IrisIcon icon={icon} className="shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-muted">Step {i + 1}</p>
                        <h3 className="text-lg font-semibold">{title}</h3>
                        <p className="mt-1 leading-relaxed text-muted">{text}</p>
                      </div>
                    </Reveal>
                  ))}
                </ol>
              </div>
              <Reveal className="rounded-panel border border-border bg-surface/60 p-4 shadow-soft sm:p-8">
                <HeroIllustration />
              </Reveal>
            </div>
          </section>

          {/* Why Anchor */}
          <section id="why" aria-labelledby="why-title" className="scroll-mt-6 border-t border-border">
            <div className={`${section} py-16 md:py-24`}>
              <Reveal className="text-center">
                <h2 id="why-title" className={h2}>Why Anchor</h2>
                <p className="mt-3 text-lg text-muted">Built so you never have to take an answer on trust.</p>
              </Reveal>
              <ul className="mt-10 grid gap-4 md:grid-cols-3">
                {REASONS.map(({ icon, title, text }, i) => (
                  <Reveal as="li" key={title} delay={i * 0.08} className={`${cardBase} transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lift`}>
                    <IrisIcon icon={icon} />
                    <h3 className="mt-8 text-lg font-semibold">{title}</h3>
                    <p className="mt-1.5 leading-relaxed text-muted">{text}</p>
                  </Reveal>
                ))}
              </ul>
            </div>
          </section>

          {/* Under the hood */}
          <section id="inside" aria-labelledby="inside-title" className="scroll-mt-6 border-t border-border">
            <div className={`${section} py-16 md:py-24`}>
              <Reveal>
                <h2 id="inside-title" className={h2}>Under the hood</h2>
                <p className="mt-3 max-w-2xl text-lg text-muted">
                  Five steps run between your question and the answer. You can watch each one in the app: turn on
                  “Show retrieval details” in Settings.
                </p>
              </Reveal>
              <ol className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {INSIDE.map(({ title, text }, i) => (
                  <Reveal as="li" key={title} delay={i * 0.06} className="rounded-card border border-border bg-surface/70 p-5">
                    <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-fg">{i + 1}</span>
                    <h3 className="mt-4 font-semibold">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
                  </Reveal>
                ))}
              </ol>
            </div>
          </section>

          {/* Closing call */}
          <section aria-labelledby="start-title" className={`${section} pb-6 sm:pb-8`}>
            <Reveal className="flex flex-col items-center rounded-panel bg-primary px-6 py-12 text-center text-primary-fg shadow-lift md:py-16">
              <Spark className="size-20" />
              <h2 id="start-title" className="mt-2 max-w-xl text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">
                Bring a document. Ask it anything.
              </h2>
              <p className="mt-3 max-w-md text-primary-fg/75">It takes a free key from Google and a file. Nothing to install.</p>
              <Button href={START} variant="inverse" size="lg" className="mt-7">
                Get started <ArrowRight className="size-4" aria-hidden />
              </Button>
            </Reveal>
          </section>
        </main>

        <footer className={`${section} flex flex-col gap-1 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between`}>
          <p>Anchor answers questions from your documents, with the page it used.</p>
          <p>A B.Tech term project, USICT, GGSIPU.</p>
        </footer>
      </Shell>
    </div>
  );
}
