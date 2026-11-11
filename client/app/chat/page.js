'use client';

import { useEffect, useState } from 'react';
import { api, keyStore } from '@/lib/api';
import { plainError } from '@/lib/plain';
import KeyGate from '@/components/KeyGate';
import Workspace from '@/components/Workspace';
import ClassicWorkspace from '@/components/classic/Workspace';
import Shell from '@/components/ui/Shell';
import Spark from '@/components/ui/Spark';
import Button from '@/components/ui/Button';

// NEXT_PUBLIC_UI=classic brings back the three-panel view with settings and the retrieval
// trace (for evaluation and demos). Read at build time.
const CLASSIC = process.env.NEXT_PUBLIC_UI === 'classic';

// Gate: no workspace until a working Gemini key is in this tab.
// session = { key, models, defaultModel }
function Home() {
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

  if (checking) {
    return (
      <Shell className="mx-auto flex h-full max-w-[1560px] flex-col items-center justify-center gap-2">
        <Spark className="size-24" busy />
        <p className="text-muted" role="status">Getting things ready…</p>
      </Shell>
    );
  }
  if (loadError) {
    return (
      <Shell as="main" className="mx-auto flex h-full max-w-[1560px] items-center justify-center p-4">
        <div className="w-full max-w-md rounded-panel border border-border bg-surface p-6 text-center shadow-soft" role="alert">
          <p>{loadError}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Button onClick={restore}>Try again</Button>
            <Button variant="ghost" onClick={logout}>Use a different key</Button>
          </div>
        </div>
      </Shell>
    );
  }
  if (!session) return <KeyGate onReady={setSession} />;
  if (CLASSIC) {
    // The classic view keeps its fixed light colours; data-theme pins the tokens of the
    // parts it shares with the main view (documents, trace, source) to light as well
    return (
      <div data-theme="light" className="h-full overflow-hidden rounded-card bg-slate-50 text-slate-900 shadow-shell">
        <ClassicWorkspace session={session} onLogout={logout} />
      </div>
    );
  }
  return <Workspace session={session} onLogout={logout} />;
}

// One screen-high frame over the page gradient; the shell inside holds the key screen,
// then the workspace
export default function ChatPage() {
  return (
    <div className="h-dvh p-2 sm:p-3 lg:p-5">
      <Home />
    </div>
  );
}
