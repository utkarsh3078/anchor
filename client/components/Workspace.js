'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { pickDefaultModel } from '@/lib/models';
import { askBody, loadPrefs, savePrefs } from '@/lib/settings';
import DocPanel from './DocPanel';
import Advanced from './Advanced';
import Chat from './Chat';
import SourceDrawer from './SourceDrawer';

// The main screen: documents on the left, chat on the right
export default function Workspace({ session, onLogout }) {
  const [choice, setChoice] = useState({ model: pickDefaultModel(session), rewriteModel: '' });
  // Retrieval settings and "show retrieval details" (under Advanced), remembered per browser
  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => savePrefs(prefs), [prefs]);
  const setSettings = (next) => setPrefs((p) => ({ ...p, settings: typeof next === 'function' ? next(p.settings) : next }));
  const setShowDetails = (showDetails) => setPrefs((p) => ({ ...p, showDetails }));
  const [docs, setDocs] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [messages, setMessages] = useState([]); // { id, role: 'user' | 'assistant' | 'error', ... }
  const [chatId, setChatId] = useState(null);
  const [asking, setAsking] = useState(false);
  const [source, setSource] = useState(null); // passage open in the drawer

  const closeSource = useCallback(() => setSource(null), []);
  const searched = docs.filter((d) => selectedIds.includes(d.docId)).map((d) => d.docName);
  const add = (msg) => setMessages((m) => [...m, { id: crypto.randomUUID(), ...msg }]);

  // failed: the error message being retried (it is replaced, and the question is not
  // shown a second time). model: used right away when switching after a quota error.
  async function ask(query, { failed, model = choice.model } = {}) {
    if (failed) setMessages((m) => m.filter((x) => x.id !== failed.id));
    else add({ role: 'user', text: query });
    setAsking(true);
    try {
      const data = await api('/api/ask', {
        method: 'POST',
        json: askBody({ query, docIds: selectedIds, chatId, settings: prefs.settings }),
        gemini: { key: session.key, model, rewriteModel: choice.rewriteModel },
      });
      setChatId(data.chatId);
      add({ role: 'assistant', data, query, docCount: selectedIds.length });
    } catch (error) {
      add({ role: 'error', error, query });
    } finally {
      setAsking(false);
    }
  }

  function switchModel(model, failed) {
    setChoice((c) => ({ ...c, model }));
    ask(failed.query, { failed, model });
  }

  function newChat() {
    setMessages([]);
    setChatId(null);
    setSource(null);
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex max-h-[45%] shrink-0 flex-col gap-5 overflow-y-auto border-b border-slate-200 bg-white p-4 md:max-h-none md:w-72 md:border-b-0 md:border-r">
        <h1 className="text-lg font-semibold">Anchor</h1>
        <DocPanel
          gemini={{ key: session.key }} selectedIds={selectedIds} setSelectedIds={setSelectedIds}
          onDocs={setDocs} onChangeKey={onLogout}
        />
        <div className="md:mt-auto">
          <Advanced
            models={session.models} choice={choice} setChoice={setChoice}
            settings={prefs.settings} setSettings={setSettings}
            showDetails={prefs.showDetails} setShowDetails={setShowDetails} onChangeKey={onLogout}
          />
        </div>
      </aside>

      <Chat
        messages={messages}
        asking={asking}
        docCount={docs.length}
        searched={searched}
        models={session.models}
        currentModel={choice.model}
        showDetails={prefs.showDetails}
        onAsk={(query) => ask(query)}
        onNewChat={newChat}
        onRetry={(failed) => ask(failed.query, { failed })}
        onSwitchModel={switchModel}
        onChangeKey={onLogout}
        onOpenSource={setSource}
      />

      <SourceDrawer source={source} onClose={closeSource} />
    </div>
  );
}
