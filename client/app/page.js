'use client';

import { useEffect, useState } from 'react';
import { api, keyStore } from '@/lib/api';
import { plainError } from '@/lib/plain';
import KeyGate from '@/components/KeyGate';
import Workspace from '@/components/Workspace';
import ClassicWorkspace from '@/components/classic/Workspace';

// NEXT_PUBLIC_UI=classic brings back the three-panel view with settings and the retrieval
// trace (for evaluation and demos). Read at build time.
const Screen = process.env.NEXT_PUBLIC_UI === 'classic' ? ClassicWorkspace : Workspace;

// Gate: no workspace until a working Gemini key is in this tab.
// session = { key, models, defaultModel }
export default function Home() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Re-checks the key kept in this tab. Only a rejected key is forgotten; if the server
  // can't be reached the key is kept so "Try again" works without retyping it.
  function restore() {
    const key = keyStore.get();
    if (!key) return setChecking(false);
    setChecking(true);
    setLoadError('');
    api('/api/gemini/models', { gemini: { key } })
      .then((r) => setSession({ key, ...r }))
      .catch((e) => {
        if (plainError(e).changeKey) keyStore.clear();
        else setLoadError(plainError(e).text);
      })
      .finally(() => setChecking(false));
  }

  useEffect(restore, []);

  const logout = () => {
    keyStore.clear();
    setLoadError('');
    setSession(null);
  };

  if (checking) return <p className="p-8 text-slate-500" role="status">Getting things ready…</p>;
  if (loadError) {
    return (
      <main className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm" role="alert">
          <p className="text-slate-800">{loadError}</p>
          <div className="flex justify-center gap-4">
            <button onClick={restore} className="rounded bg-slate-900 px-4 py-2 text-white">Try again</button>
            <button onClick={logout} className="text-sm text-slate-600 underline">Use a different key</button>
          </div>
        </div>
      </main>
    );
  }
  if (!session) return <KeyGate onReady={setSession} />;
  return <Screen session={session} onLogout={logout} />;
}
