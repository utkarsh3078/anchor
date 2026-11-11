'use client';

import { useState } from 'react';
import { ArrowRight, ExternalLink, ShieldCheck } from 'lucide-react';
import { api, keyStore } from '@/lib/api';
import { plainError } from '@/lib/plain';
import Shell from './ui/Shell';
import Logo from './ui/Logo';
import Spark from './ui/Spark';
import ThemeToggle from './ui/ThemeToggle';
import { buttonClass } from './ui/Button';

const KEY_HELP_URL = 'https://aistudio.google.com/apikey';

// Key screen: asks for the visitor's Gemini key once per tab and checks it by listing
// models (a metadata call, it does not use generation quota). The list also fills the
// model pickers.
export default function KeyGate({ onReady }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    try {
      const r = await api('/api/gemini/models', { gemini: { key: trimmed } });
      keyStore.set(trimmed);
      onReady({ key: trimmed, ...r });
    } catch (err) {
      setError(err.code === 'gemini_key_invalid' ? "Google didn't accept that key. Check it and try again." : plainError(err).text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell className="relative mx-auto flex h-full max-w-[1560px] flex-col overflow-y-auto">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8 sm:py-5">
        <Logo />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-10">
        <div className="w-full max-w-md text-center">
          <Spark className="mx-auto size-24 sm:size-28" busy={busy} />
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.03em]">Add your key</h1>
          <p className="mt-3 text-muted text-pretty">
            Anchor uses your own Gemini key to read your files and write answers. Google offers a free one.
          </p>

          <form onSubmit={submit} className="mt-8 rounded-panel border border-border bg-surface p-5 text-left shadow-soft sm:p-6">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="gemini-key" className="text-sm font-semibold">Your Gemini API key</label>
              <a className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline" href={KEY_HELP_URL} target="_blank" rel="noreferrer">
                How to get a key <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </div>
            <input
              id="gemini-key"
              type="password"
              autoComplete="off"
              autoFocus
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste your key here"
              aria-describedby={error ? 'gemini-key-error' : undefined}
              aria-invalid={error ? true : undefined}
              className="mt-2 h-12 w-full rounded-full border border-border-strong bg-surface px-4 font-mono text-sm placeholder:font-sans placeholder:text-muted"
            />
            {error && <p id="gemini-key-error" className="mt-2 text-sm text-danger-fg" role="alert">{error}</p>}
            <button disabled={busy || !key.trim()} className={buttonClass({ size: 'lg', className: 'mt-4 w-full' })}>
              {busy ? 'Checking your key…' : <>Start <ArrowRight className="size-4" aria-hidden /></>}
            </button>
            <p className="mt-4 text-sm text-muted">
              No key yet? Open{' '}
              <a className="font-medium text-accent underline underline-offset-2" href={KEY_HELP_URL} target="_blank" rel="noreferrer">Google AI Studio</a>,
              sign in, press “Create API key” and paste it above.
            </p>
          </form>

          <p className="mx-auto mt-5 flex max-w-sm items-start gap-2 text-left text-sm text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            Your key stays in this browser tab and is sent to Anchor only with your requests. Anchor never saves it.
          </p>
        </div>
      </main>
    </Shell>
  );
}
