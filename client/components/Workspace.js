'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { pickDefaultModel } from '@/lib/models';
import { askBody, loadPrefs, savePrefs } from '@/lib/settings';
import Shell from './ui/Shell';
import Sidebar from './Sidebar';
import DocPanel from './DocPanel';
import SettingsView from './SettingsView';
import Usage from './Usage';
import Chat from './Chat';
import SourceDrawer from './SourceDrawer';

const isWide = () => window.matchMedia('(min-width: 1280px)').matches; // Tailwind's xl: documents beside the chat

// The main screen, three parts inside one shell: the rail (screens, key), the current
// screen (ask / settings / key usage), and the documents. Below xl the documents are a
// screen of their own; below lg the rail becomes a row of tabs.
export default function Workspace({ session, onLogout }) {
  const [view, setView] = useState('ask'); // 'ask' | 'docs' | 'settings' | 'usage'
  const [choice, setChoice] = useState({ model: pickDefaultModel(session), rewriteModel: '' });
  // Retrieval settings and "show retrieval details" (Settings screen), remembered per browser
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
  const [usageKey, setUsageKey] = useState(0); // bumped after anything that uses the key, to refresh the usage screen
  const usageChanged = useCallback(() => setUsageKey((n) => n + 1), []);
  const docPanel = useRef(null); // { pickFile, openPaste }

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
      usageChanged();
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

  // Uploading and pasting live in the documents panel; when that panel is a screen of
  // its own, go there to show the progress
  const toDocs = (action) => () => {
    docPanel.current?.[action]();
    if (!isWide()) setView('docs');
  };

  const screen = 'min-h-0 min-w-0 flex-1 flex-col';
  return (
    <Shell className="mx-auto flex h-full max-w-[1560px] flex-col overflow-hidden lg:flex-row">
      <Sidebar
        view={view} setView={setView} tickedCount={selectedIds.length}
        keyTail={session.key.slice(-4)} onChangeKey={onLogout}
      />

      <Chat
        className={`${screen} ${view === 'ask' ? 'flex' : view === 'docs' ? 'hidden xl:flex' : 'hidden'}`}
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
        onModel={(model) => setChoice((c) => ({ ...c, model }))}
        onChangeKey={onLogout}
        onOpenSource={setSource}
        onAttach={toDocs('pickFile')}
        onPaste={toDocs('openPaste')}
        onOpenSettings={() => setView('settings')}
      />

      {view === 'settings' && (
        <SettingsView
          className={`flex ${screen}`}
          models={session.models} choice={choice} setChoice={setChoice}
          settings={prefs.settings} setSettings={setSettings}
          showDetails={prefs.showDetails} setShowDetails={setShowDetails} onChangeKey={onLogout}
        />
      )}

      {view === 'usage' && (
        <main className={`relative flex ${screen} overflow-y-auto overscroll-contain px-4 py-6 sm:px-8 lg:py-10`}>
          <div className="mx-auto w-full max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-tight">Key usage</h1>
            <p className="mt-1.5 text-muted">What your Gemini key has used through Anchor, next to its free limits.</p>
            <div className="mt-6 rounded-card border border-border bg-surface p-5 shadow-soft sm:p-6">
              <Usage gemini={{ key: session.key, model: choice.model }} refreshKey={usageKey} />
            </div>
          </div>
        </main>
      )}

      {/* Always mounted (it owns the list and the upload); a screen of its own below xl */}
      <aside
        className={`${view === 'docs' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col bg-surface p-4 sm:p-5 lg:m-3 lg:rounded-panel lg:shadow-soft xl:flex xl:w-[340px] xl:flex-none 2xl:w-[380px]`}
      >
        <DocPanel
          ref={docPanel} className="min-h-0 flex-1"
          gemini={{ key: session.key }} selectedIds={selectedIds} setSelectedIds={setSelectedIds}
          onDocs={(list) => { setDocs(list); usageChanged(); }} onChangeKey={onLogout}
        />
      </aside>

      <SourceDrawer source={source} apiKey={session.key} onClose={closeSource} />
    </Shell>
  );
}
