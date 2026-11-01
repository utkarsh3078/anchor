'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import DocPanel from './DocPanel';
import SettingsPanel from './SettingsPanel';
import Chat from './Chat';
import Trace from './Trace';
import SourceViewer from './SourceViewer';

function pickDefaultModel({ models, defaultModel }) {
  if (models.some((m) => m.id === defaultModel)) return defaultModel;
  return models.find((m) => m.id.includes('flash'))?.id ?? models[0]?.id ?? defaultModel;
}

// Three panels: documents + settings | chat | retrieval trace
export default function Workspace({ session, onLogout }) {
  const [settings, setSettings] = useState({
    mode: 'anchor', k: 10, threshold: 0.15, maxRetries: 1, model: pickDefaultModel(session), rewriteModel: '',
  });
  const [selectedIds, setSelectedIds] = useState([]);
  const [messages, setMessages] = useState([]); // { id, role: 'user' | 'assistant' | 'error', ... }
  const [chatId, setChatId] = useState(null);
  const [traceId, setTraceId] = useState(null);
  const [asking, setAsking] = useState(false);
  const [rightTab, setRightTab] = useState('trace');
  const [source, setSource] = useState(null); // passage open in the viewer

  const openSource = (passage) => {
    setSource(passage);
    setRightTab('source');
  };

  const gemini = { key: session.key, model: settings.model, rewriteModel: settings.rewriteModel };

  const add = (msg) => {
    const id = crypto.randomUUID();
    setMessages((m) => [...m, { id, ...msg }]);
    return id;
  };

  async function ask(query) {
    add({ role: 'user', text: query });
    setAsking(true);
    try {
      const body = { query, k: settings.k, docIds: selectedIds, mode: settings.mode, chatId: chatId ?? undefined };
      if (settings.mode === 'anchor') Object.assign(body, { threshold: settings.threshold, maxRetries: settings.maxRetries });
      const data = await api('/api/ask', { method: 'POST', json: body, gemini });
      setChatId(data.chatId);
      setTraceId(add({ role: 'assistant', data, query }));
      setRightTab('trace');
    } catch (err) {
      add({ role: 'error', error: err, query });
    } finally {
      setAsking(false);
    }
  }

  function newChat() {
    setMessages([]);
    setChatId(null);
    setTraceId(null);
  }

  const traced = messages.find((m) => m.id === traceId) ?? null;

  return (
    <div className="grid h-full grid-cols-[17rem_minmax(0,1fr)_minmax(24rem,34rem)]">
      <aside className="flex flex-col gap-6 overflow-y-auto border-r border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Anchor</h1>
          <button onClick={onLogout} className="text-xs text-slate-500 underline">Change key</button>
        </div>
        <DocPanel gemini={gemini} selectedIds={selectedIds} setSelectedIds={setSelectedIds} />
        <SettingsPanel settings={settings} setSettings={setSettings} models={session.models} />
      </aside>

      <Chat
        messages={messages}
        asking={asking}
        canAsk={selectedIds.length > 0}
        onAsk={ask}
        onNewChat={newChat}
        onShowTrace={(id) => {
          setTraceId(id);
          setRightTab('trace');
        }}
        onOpenSource={openSource}
        traceId={traceId}
        models={session.models}
        onSwitchModel={(model) => setSettings((s) => ({ ...s, model }))}
        onRetry={(query) => ask(query)}
      />

      <aside className="flex h-full min-h-0 flex-col border-l border-slate-200 bg-white">
        <div className="flex border-b border-slate-200 text-sm">
          {['trace', 'source'].map((tab) => (
            <button
              key={tab}
              onClick={() => setRightTab(tab)}
              className={`flex-1 px-3 py-2 ${rightTab === tab ? 'border-b-2 border-slate-900 font-medium' : 'text-slate-500'}`}
            >
              {tab === 'trace' ? 'Retrieval trace' : `Source${source ? ` · p.${source.page}` : ''}`}
            </button>
          ))}
        </div>
        <div className={`min-h-0 flex-1 ${rightTab === 'trace' ? 'overflow-y-auto' : ''}`}>
          {rightTab === 'trace' ? <Trace message={traced} onOpen={openSource} /> : <SourceViewer source={source} />}
        </div>
      </aside>
    </div>
  );
}
