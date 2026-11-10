'use client';

import { useState } from 'react';
import { api, keyStore } from '@/lib/api';
import { plainError } from '@/lib/plain';

const KEY_HELP_URL = 'https://aistudio.google.com/apikey';

// Setup screen: asks for the visitor's Gemini key once per tab and checks it by listing
// models (a metadata call, it does not use generation quota). The list also fills the
// model pickers under "Advanced".
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
    <main className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold">Anchor</h1>
          <p className="mt-1 text-sm text-slate-600">
            Ask questions about your documents. Every answer shows the page it came from.
          </p>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="gemini-key" className="text-sm font-medium">Your Gemini API key</label>
            <a className="text-sm text-blue-700 underline" href={KEY_HELP_URL} target="_blank" rel="noreferrer">
              How to get a key
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
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm"
          />
        </div>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <button disabled={busy || !key.trim()} className="w-full rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
          {busy ? 'Checking your key…' : 'Start'}
        </button>
        <p className="text-xs text-slate-500">
          No key yet? Open{' '}
          <a className="underline" href={KEY_HELP_URL} target="_blank" rel="noreferrer">Google AI Studio</a>,
          sign in, press “Create API key” and paste it above. Google offers a free tier.
        </p>
        <p className="text-xs text-slate-500">
          Your key stays in this browser tab and is sent to Anchor only with your requests.
          Anchor never saves it.
        </p>
      </form>
    </main>
  );
}
