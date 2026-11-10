'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { plainError } from '@/lib/plain';

// Document list: tick the documents a question should search, upload a file, paste
// text, remove. onChangeKey (optional) lets a rejected key lead back to the setup screen.
export default function DocPanel({ gemini, selectedIds, setSelectedIds, onDocs, onChangeKey }) {
  const [docs, setDocs] = useState(null); // null until the first load finishes
  const [busy, setBusy] = useState('');
  const [slow, setSlow] = useState(false); // the current upload has run for a while
  const [error, setError] = useState(null); // { text, changeKey, reload }
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

  const load = () => {
    setError(null);
    refresh().catch((e) => setError({ ...plainError(e), reload: true }));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // upload: the request embeds text, so it can be slow and its quota errors are the
  // embedding model's
  async function run(label, fn, { upload = false } = {}) {
    setBusy(label);
    setError(null);
    const timer = upload && setTimeout(() => setSlow(true), 20000);
    try {
      await fn();
    } catch (e) {
      setError(plainError(e, { upload }));
    } finally {
      clearTimeout(timer);
      setSlow(false);
      setBusy('');
    }
  }

  const upload = (file) => run(`Reading ${file.name}…`, async () => {
    const form = new FormData();
    form.append('file', file);
    const r = await api('/api/documents', { method: 'POST', form, gemini });
    await refresh(r.docId);
  }, { upload: true });

  const submitPaste = () => run('Reading your text…', async () => {
    const r = await api('/api/documents/text', { method: 'POST', json: paste, gemini });
    setPaste({ name: '', text: '' });
    setPasteOpen(false);
    await refresh(r.docId);
  }, { upload: true });

  const remove = (doc) => {
    if (!confirm(`Remove ${doc.docName}? You can upload it again later.`)) return;
    run(`Removing ${doc.docName}…`, async () => {
      await api(`/api/documents/${doc.docId}`, { method: 'DELETE' });
      await refresh();
    });
  };

  const toggle = (id) => setSelectedIds((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  const list = docs ?? [];

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Documents</h2>

      {docs === null && !error && <p className="text-sm text-slate-500">Loading your documents…</p>}
      {docs !== null && list.length === 0 && (
        <p className="text-sm text-slate-600">No documents yet. Upload a PDF or text file to start.</p>
      )}

      {list.length > 0 && (
        <>
          <ul className="space-y-1">
            {list.map((d) => (
              <li key={d.docId} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={selectedIds.includes(d.docId)} onChange={() => toggle(d.docId)} />
                  <span className="truncate" title={d.docName}>{d.docName}</span>
                </label>
                <span className="shrink-0 text-xs text-slate-400">{d.pages} {d.pages === 1 ? 'page' : 'pages'}</span>
                <button
                  onClick={() => remove(d)} disabled={!!busy} aria-label={`Remove ${d.docName}`} title="Remove"
                  className="shrink-0 px-1 text-xs text-slate-400 hover:text-red-600 disabled:opacity-40"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">Questions look only in the ticked documents.</p>
        </>
      )}

      <button
        disabled={!!busy} onClick={() => fileInput.current?.click()}
        className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Upload a document
      </button>
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
      <p className="text-xs text-slate-500">
        PDF, .txt or .md, up to 25 MB.{' '}
        <button disabled={!!busy} onClick={() => setPasteOpen((o) => !o)} className="underline disabled:opacity-50">
          {pasteOpen ? 'Cancel pasting' : 'Or paste text instead'}
        </button>
      </p>

      {pasteOpen && (
        <div className="space-y-2">
          <input
            value={paste.name}
            onChange={(e) => setPaste((p) => ({ ...p, name: e.target.value }))}
            placeholder="A name, e.g. Lecture notes"
            aria-label="Name for the pasted text"
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <textarea
            value={paste.text}
            onChange={(e) => setPaste((p) => ({ ...p, text: e.target.value }))}
            rows={5}
            placeholder="Paste your text here…"
            aria-label="Text to add"
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            disabled={!!busy || !paste.name.trim() || !paste.text.trim()}
            onClick={submitPaste}
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
          >
            Add this text
          </button>
        </div>
      )}

      {busy && (
        <p className="flex items-center gap-2 text-xs text-slate-600" role="status">
          <span className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-slate-300 border-t-slate-700 motion-safe:animate-spin" />
          <span className="min-w-0 break-words">
            {busy}{' '}
            {slow
              ? "Still reading. Large documents are read in steps to stay within your Gemini key's free per-minute limit, so this can take a few minutes."
              : 'Longer documents take more time.'}
          </span>
        </p>
      )}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800" role="alert">
          <p>{error.text}</p>
          {error.reload && <button onClick={load} className="mt-1 underline">Try again</button>}
          {error.changeKey && onChangeKey && <button onClick={onChangeKey} className="mt-1 underline">Enter key again</button>}
        </div>
      )}
    </section>
  );
}
