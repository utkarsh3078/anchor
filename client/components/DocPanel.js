'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

// Document library: list with checkboxes (questions search only checked docs),
// upload a file, paste text, delete.
export default function DocPanel({ gemini, selectedIds, setSelectedIds, onDocs }) {
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState({ name: '', text: '' });
  const fileInput = useRef(null);

  async function refresh(selectNewId) {
    const list = await api('/api/documents');
    setDocs(list);
    onDocs?.(list);
    const ids = new Set(list.map((d) => d.docId));
    setSelectedIds((sel) => {
      const kept = sel.filter((id) => ids.has(id));
      if (selectNewId) return [...kept, selectNewId];
      return kept.length || sel.length ? kept : list.map((d) => d.docId); // first load: select all
    });
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(label, fn) {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  const upload = (file) => run(`Indexing ${file.name}…`, async () => {
    const form = new FormData();
    form.append('file', file);
    const r = await api('/api/documents', { method: 'POST', form, gemini });
    await refresh(r.docId);
  });

  const submitPaste = () => run('Indexing pasted text…', async () => {
    const r = await api('/api/documents/text', { method: 'POST', json: paste, gemini });
    setPaste({ name: '', text: '' });
    setPasteOpen(false);
    await refresh(r.docId);
  });

  const remove = (doc) => {
    if (!confirm(`Delete ${doc.docName} from the index?`)) return;
    run('Deleting…', async () => {
      await api(`/api/documents/${doc.docId}`, { method: 'DELETE' });
      await refresh();
    });
  };

  const toggle = (id) => setSelectedIds((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Documents</h2>
      {docs.length === 0 && <p className="text-sm text-slate-500">No documents yet. Upload a PDF to start.</p>}
      <ul className="space-y-1">
        {docs.map((d) => (
          <li key={d.docId} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selectedIds.includes(d.docId)} onChange={() => toggle(d.docId)} />
            <span className="flex-1 truncate" title={d.docName}>{d.docName}</span>
            <span className="text-xs text-slate-400">{d.pages}p</span>
            <button onClick={() => remove(d)} className="text-xs text-slate-400 hover:text-red-600" title="Delete">✕</button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <button disabled={!!busy} onClick={() => fileInput.current?.click()} className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50">
          Upload file
        </button>
        <button disabled={!!busy} onClick={() => setPasteOpen((o) => !o)} className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50">
          Paste text
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.txt,.md"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) upload(file);
        }}
      />

      {pasteOpen && (
        <div className="space-y-2">
          <input
            value={paste.name}
            onChange={(e) => setPaste((p) => ({ ...p, name: e.target.value }))}
            placeholder="Name, e.g. lecture-notes.txt"
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <textarea
            value={paste.text}
            onChange={(e) => setPaste((p) => ({ ...p, text: e.target.value }))}
            rows={5}
            placeholder="Paste text…"
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            disabled={!!busy || !paste.name.trim() || !paste.text.trim()}
            onClick={submitPaste}
            className="w-full rounded bg-slate-900 px-2 py-1 text-sm text-white disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}

      {busy && <p className="text-xs text-slate-500">{busy}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </section>
  );
}
