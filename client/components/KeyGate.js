'use client';

import { useState } from 'react';
import { api, keyStore } from '@/lib/api';

// Asks for the visitor's Gemini key and checks it by listing models (a metadata call,
// it does not use generation quota). The model list then fills the model picker.
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
      setError(err.code === 'gemini_key_invalid' ? 'That key was rejected by Google. Check it and try again.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold">Anchor</h1>
          <p className="mt-1 text-sm text-slate-600">Self-correcting, cited answers from your documents.</p>
        </div>
        <label className="block text-sm font-medium">
          Gemini API key
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="AIza…"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy || !key.trim()} className="w-full rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
          {busy ? 'Checking…' : 'Continue'}
        </button>
        <p className="text-xs text-slate-500">
          Get a free key at{' '}
          <a className="underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>.
          The key stays in this browser tab and is sent only to the Anchor server with each request.
          It is never stored on the server.
        </p>
      </form>
    </main>
  );
}
