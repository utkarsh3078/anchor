'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

import { THEME_KEY } from '@/lib/theme';

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
const current = () => document.documentElement.dataset.theme || (systemDark() ? 'dark' : 'light');

// Switches between light and dark. The choice is remembered in this browser; until one is
// made the page follows the system setting (see globals.css).
export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(null); // unknown until mounted (the server can't know)

  useEffect(() => setTheme(current()), []);

  function toggle() {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ }
    setTheme(next);
  }

  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`inline-flex size-9 items-center justify-center rounded-full text-muted transition-colors duration-200 ease-out hover:bg-surface-2 hover:text-fg ${className}`}
    >
      {theme === 'dark' ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
    </button>
  );
}
