'use client';

import Link from 'next/link';
import { BookOpen, Files, Gauge, House, KeyRound, MessagesSquare, Settings } from 'lucide-react';
import Logo from './ui/Logo';
import ThemeToggle from './ui/ThemeToggle';

// Phones: four equal tabs, icon over label. From sm: a row of pills. From lg: the rail.
const item =
  'relative flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-xs transition-colors duration-200 ease-out ' +
  'sm:shrink-0 sm:flex-row sm:gap-3 sm:rounded-full sm:px-3.5 sm:text-sm lg:px-4 lg:py-2.5 lg:text-[15px]';
const idle = 'text-muted hover:bg-surface/60 hover:text-fg';
const on = 'bg-surface font-semibold text-fg shadow-soft';
// "Documents" is a screen of its own below xl; from xl up the documents sit beside the
// chat, so there "Ask" stays the current item
const onFromXl = `${idle} xl:bg-surface xl:font-semibold xl:text-fg xl:shadow-soft`;

function NavButton({ icon: Icon, label, state, badge, className = '', ...props }) {
  return (
    <button type="button" aria-current={state === on ? 'page' : undefined} className={`${item} ${state} ${className}`} {...props}>
      <Icon className="size-[18px] shrink-0" aria-hidden />
      <span className="lg:flex-1 lg:text-left">{label}</span>
      {badge > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-fg max-sm:absolute max-sm:right-[18%] max-sm:top-0.5 max-sm:h-4 max-sm:min-w-4 max-sm:px-1 max-sm:text-[10px]">
          {badge}
        </span>
      )}
    </button>
  );
}

// Left rail (a top bar with tabs on small screens): the logo, the screens of the app, and
// the key in use. view: 'ask' | 'docs' | 'settings' | 'usage'.
export default function Sidebar({ view, setView, tickedCount, keyTail, onChangeKey }) {
  return (
    <aside className="flex shrink-0 flex-col gap-3 border-b border-border px-3 pb-2 pt-3 lg:w-64 lg:gap-0 lg:border-b-0 lg:border-r lg:p-5">
      <div className="flex items-center justify-between px-1 lg:px-2">
        <Logo />
        <ThemeToggle />
      </div>

      <nav aria-label="Screens" className="grid grid-cols-4 gap-1 sm:flex lg:mt-8 lg:flex-col lg:gap-1.5">
        <NavButton
          icon={MessagesSquare} label="Ask" onClick={() => setView('ask')}
          state={view === 'ask' ? on : view === 'docs' ? onFromXl : idle}
        />
        <NavButton
          icon={Files} label="Documents" badge={tickedCount} onClick={() => setView('docs')}
          state={view === 'docs' ? on : idle} className="xl:hidden"
        />
        <NavButton icon={Settings} label="Settings" onClick={() => setView('settings')} state={view === 'settings' ? on : idle} />
        <NavButton icon={Gauge} label="Key usage" onClick={() => setView('usage')} state={view === 'usage' ? on : idle} />
      </nav>

      <div className="hidden lg:mt-8 lg:block">
        <p className="px-4 text-sm font-semibold">About</p>
        <div className="mt-2 flex flex-col gap-1.5">
          <Link href="/#how" className={`${item} ${idle}`}>
            <BookOpen className="size-[18px] shrink-0" aria-hidden /> How it works
          </Link>
          <Link href="/" className={`${item} ${idle}`}>
            <House className="size-[18px] shrink-0" aria-hidden /> Home page
          </Link>
        </div>
      </div>

      <div className="mt-auto hidden rounded-card bg-linear-to-br from-steel-1 to-steel-2 p-4 text-white shadow-soft lg:block">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15">
            <KeyRound className="size-[18px]" aria-hidden />
            <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-steel-2 bg-[#4ade80]" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Your Gemini key</p>
            <p className="truncate text-xs">
              <span className="sr-only">ends in </span>
              <span className="font-mono" aria-hidden>••••</span>
              <span className="font-mono">{keyTail}</span> · this tab
            </p>
          </div>
        </div>
        <button
          type="button" onClick={onChangeKey}
          className="mt-3 h-10 w-full rounded-full border border-white/25 bg-white/10 text-sm font-medium transition-colors duration-200 hover:bg-white/20"
        >
          Use a different key
        </button>
      </div>
    </aside>
  );
}
