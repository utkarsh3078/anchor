import { Check } from 'lucide-react';

export const STEPS = ['Add key', 'Upload', 'Ask'];

// 1 Add key → 2 Upload → 3 Ask. current: 0-based index of the step on screen.
export default function Stepper({ current }) {
  return (
    <nav aria-label="Progress">
      <ol className="flex items-center gap-2 text-sm">
        {STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={label} className="flex items-center gap-2">
              {i > 0 && <span className={`h-px w-4 sm:w-8 ${done || active ? 'bg-accent' : 'bg-border-strong'}`} aria-hidden />}
              <span className="flex items-center gap-1.5" aria-current={active ? 'step' : undefined}>
                <span
                  className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200 ${
                    done ? 'bg-accent text-accent-fg' : active ? 'border-2 border-accent text-accent' : 'border border-border-strong text-muted'
                  }`}
                >
                  {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
                </span>
                <span className={`hidden sm:inline ${active ? 'font-medium text-fg' : 'text-muted'}`}>{label}</span>
                <span className="sr-only">{done ? ' (done)' : active ? ' (current step)' : ''}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
