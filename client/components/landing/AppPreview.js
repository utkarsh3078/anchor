import { Anchor, ArrowUp, Check, Cpu, Gauge, MessagesSquare, Paperclip, Settings, Sparkles, Upload } from 'lucide-react';

const DOCS = [
  { name: 'syllabus.pdf', pages: 24, ticked: true },
  { name: 'lecture-notes.md', pages: 6, ticked: true },
  { name: 'lab-manual.pdf', pages: 40, ticked: false },
];

const chip = 'rounded-full border border-border-strong bg-surface px-2.5 py-0.5 text-[11px] font-medium';
const cite = 'mx-0.5 rounded-full bg-accent-soft px-1.5 font-sans text-[10px] font-semibold leading-4 text-accent-soft-fg';

// A small, static copy of the chat screen for the landing page, drawn with the same
// tokens as the real one (components/Workspace.js), so the two always match. The question
// and answer are made up; nothing here is clickable.
export default function AppPreview() {
  return (
    <div
      role="img"
      aria-label="Example of the Anchor screen: the question “When is the final exam?” is answered with “Monday, 14 May”, marked as coming from page 12 of syllabus.pdf, next to a list of uploaded documents."
      className="overflow-hidden rounded-panel p-2.5 shadow-lift sm:p-5 lg:p-7"
      style={{ background: 'var(--page)' }}
    >
      <div aria-hidden className="grid select-none rounded-[26px] border border-shell-border bg-shell text-left shadow-shell md:grid-cols-[180px_minmax(0,1fr)] lg:grid-cols-[180px_minmax(0,1fr)_236px]">
        {/* Rail */}
        <div className="hidden flex-col border-r border-border p-4 md:flex">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-primary-fg">
              <Anchor className="size-3.5" strokeWidth={2.4} />
            </span>
            <span className="font-bold tracking-tight">Anchor</span>
          </div>
          <div className="mt-6 space-y-1 text-[13px]">
            <div className="flex items-center gap-2.5 rounded-full bg-surface px-3 py-2 font-semibold shadow-soft">
              <MessagesSquare className="size-4" /> Ask
            </div>
            <div className="flex items-center gap-2.5 px-3 py-2 text-muted"><Settings className="size-4" /> Settings</div>
            <div className="flex items-center gap-2.5 px-3 py-2 text-muted"><Gauge className="size-4" /> Key usage</div>
          </div>
        </div>

        {/* Chat */}
        <div className="flex min-w-0 flex-col gap-3 p-3 sm:p-5">
          <div className="ml-auto w-fit rounded-bubble rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-fg shadow-soft">
            When is the final exam?
          </div>

          <div className="rounded-card border border-border bg-surface p-4 shadow-soft">
            <p className="font-serif text-base leading-relaxed sm:text-[17px]">
              The final exam is on <strong>Monday, 14 May</strong><span className={cite}>1</span> and covers
              units 1 to 5<span className={cite}>2</span>.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3 text-xs">
              <span className="text-muted">From syllabus.pdf:</span>
              <span className={chip}>Page 3</span>
              <span className={`${chip} border-accent bg-accent-soft text-accent-soft-fg`}>Page 12</span>
            </div>
            <div className="mt-3 rounded-control border border-border bg-surface-2/60 p-3 text-xs leading-relaxed text-muted">
              <span className="font-medium text-fg">syllabus.pdf, page 12</span>
              <span className="mt-1 block">
                … <mark className="rounded-sm bg-highlight px-0.5 text-fg">The end-term examination will be held on Monday, 14 May.</mark> Students
                must carry their admit card …
              </span>
            </div>
          </div>

          <div className="mt-auto rounded-[22px] border border-border bg-surface/70 p-2.5 shadow-soft">
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted">
              <Sparkles className="size-3.5 text-subtle" /> Ask a question about your document…
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-medium">
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3"><Paperclip className="size-3.5 text-muted" /> Attach</span>
              <span className="hidden h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 sm:inline-flex"><Cpu className="size-3.5 text-muted" /> Model</span>
              <span className="ml-auto inline-flex size-8 items-center justify-center rounded-full bg-primary text-primary-fg"><ArrowUp className="size-4" /></span>
            </div>
          </div>
        </div>

        {/* Documents */}
        <div className="m-2.5 hidden flex-col rounded-[20px] bg-surface p-4 shadow-soft lg:flex">
          <p className="text-lg font-semibold tracking-tight">Documents</p>
          <ul className="mt-2 divide-y divide-border text-[13px]">
            {DOCS.map((d) => (
              <li key={d.name} className="flex items-start gap-2.5 py-2.5">
                <span className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] ${d.ticked ? 'bg-primary text-primary-fg' : 'border border-border-strong'}`}>
                  {d.ticked && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="block text-xs text-muted">{d.pages} pages</span>
                </span>
              </li>
            ))}
          </ul>
          <span className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-full bg-primary text-[13px] font-medium text-primary-fg">
            <Upload className="size-3.5" /> Upload a document
          </span>
        </div>
      </div>
    </div>
  );
}
