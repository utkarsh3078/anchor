'use client';

import { useEffect, useState } from 'react';
import { api, keyStore } from '@/lib/api';
import KeyGate from '@/components/KeyGate';
import Workspace from '@/components/Workspace';

// Gate: no workspace until a working Gemini key is in this tab.
// session = { key, models, defaultModel }
export default function Home() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const key = keyStore.get();
    if (!key) return setChecking(false);
    api('/api/gemini/models', { gemini: { key } })
      .then((r) => setSession({ key, ...r }))
      .catch(() => keyStore.clear())
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <p className="p-8 text-slate-500">Loading…</p>;
  if (!session) return <KeyGate onReady={setSession} />;
  return (
    <Workspace
      session={session}
      onLogout={() => {
        keyStore.clear();
        setSession(null);
      }}
    />
  );
}
