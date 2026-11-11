'use client';

import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ClipboardPaste, FileText, Search, Upload, X } from 'lucide-react';
import { api } from '@/lib/api';
import { plainError } from '@/lib/plain';

const field =
  'w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-sm placeholder:text-muted';

// The documents panel: tick the documents a question should search, find one by name,
// upload a file, paste text, remove. onChangeKey (optional) lets a rejected key lead back
// to the key screen. ref: { pickFile(), openPaste() } for the buttons elsewhere on the
// screen that start an upload.
export default function DocPanel({ ref, className = '', gemini, selectedIds, setSelectedIds, onDocs, onChangeKey }) {
  const [docs, setDocs] = useState(null); // null until the first load finishes
  const [busy, setBusy] = useState('');
  const [slow, setSlow] = useState(false); // the current upload has run for a while
  const [error, setError] = useState(null); // { text, changeKey, reload }
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState({ name: '', text: '' });
  const [filter, setFilter] = useState('');
  const fileInput = useRef(null);
  const pasteName = useRef(null);

  useImperativeHandle(ref, () => ({
    pickFile: () => fileInput.current?.click(),
    openPaste: () => setPasteOpen(true),
  }), []);

  useEffect(() => {
    if (pasteOpen) pasteName.current?.focus();
  }, [pasteOpen]);

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
  const needle = filter.trim().toLowerCase();
  const shown = needle ? list.filter((d) => d.docName.toLowerCase().includes(needle)) : list;

  return (
    <section className={`flex flex-col ${className}`} aria-labelledby="docs-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="docs-title" className="text-2xl font-semibold tracking-tight">Documents</h2>
        <button
          type="button" disabled={!!busy} onClick={() => setPasteOpen((o) => !o)}
          aria-expanded={pasteOpen} aria-label={pasteOpen ? 'Cancel pasting' : 'Paste text instead of a file'}
          title={pasteOpen ? 'Cancel pasting' : 'Paste text instead of a file'}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted transition-colors duration-200 hover:text-fg disabled:opacity-50"
        >
          {pasteOpen ? <X className="size-[18px]" aria-hidden /> : <ClipboardPaste className="size-[18px]" aria-hidden />}
        </button>
      </div>

      {pasteOpen && (
        <div className="mt-4 space-y-2 rounded-card border border-border bg-surface-2/60 p-3">
          <input
            ref={pasteName}
            value={paste.name}
            onChange={(e) => setPaste((p) => ({ ...p, name: e.target.value }))}
            placeholder="A name, e.g. Lecture notes"
            aria-label="Name for the pasted text"
            className={field}
          />
          <textarea
            value={paste.text}
            onChange={(e) => setPaste((p) => ({ ...p, text: e.target.value }))}
            rows={5}
            placeholder="Paste your text here…"
            aria-label="Text to add"
            className={field}
          />
          <button
            type="button"
            disabled={!!busy || !paste.name.trim() || !paste.text.trim()}
            onClick={submitPaste}
            className="h-10 w-full rounded-full border border-border-strong bg-surface text-sm font-medium transition-colors duration-200 hover:bg-surface-2 disabled:opacity-50"
          >
            Add this text
          </button>
        </div>
      )}

      {list.length > 1 && (
        <label className="relative mt-4 block">
          <span className="sr-only">Find a document by name</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search…"
            className="h-11 w-full rounded-full border border-border-strong bg-surface pl-10 pr-4 text-sm placeholder:text-muted"
          />
        </label>
      )}

      <div className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto px-1">
        {docs === null && !error && <p className="py-2 text-sm text-muted">Loading your documents…</p>}
        {docs !== null && list.length === 0 && (
          <div className="flex flex-col items-center rounded-card border border-dashed border-border-strong px-4 py-8 text-center">
            <FileText className="size-6 text-subtle" aria-hidden />
            <p className="mt-2 font-medium">No documents yet</p>
            <p className="mt-1 text-sm text-muted">Upload a PDF or a text file to start.</p>
          </div>
        )}
        {list.length > 0 && shown.length === 0 && <p className="py-2 text-sm text-muted">No document has “{filter.trim()}” in its name.</p>}

        {shown.length > 0 && (
          <ul className="divide-y divide-border">
            {shown.map((d) => (
              <li key={d.docId} className="group flex items-start gap-1 py-3">
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox" checked={selectedIds.includes(d.docId)} onChange={() => toggle(d.docId)}
                    className="mt-0.5 size-[18px] shrink-0 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium leading-snug" title={d.docName}>{d.docName}</span>
                    <span className="block text-sm text-muted">{d.pages} {d.pages === 1 ? 'page' : 'pages'}</span>
                  </span>
                </label>
                <button
                  type="button" onClick={() => remove(d)} disabled={!!busy} aria-label={`Remove ${d.docName}`} title="Remove"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-subtle transition-colors duration-200 hover:bg-danger-soft hover:text-danger-fg disabled:opacity-40"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.length > 0 && <p className="pb-1 pt-2 text-xs text-muted">Questions look only in the ticked documents.</p>}
      </div>

      <div className="mt-3 space-y-3">
        {busy && (
          <p className="flex items-start gap-2 text-xs text-muted" role="status">
            <span className="mt-0.5 inline-block size-3 shrink-0 rounded-full border-2 border-border-strong border-t-fg motion-safe:animate-spin" />
            <span className="min-w-0 break-words">
              {busy}{' '}
              {slow
                ? "Still reading. Large documents are read in steps to stay within your Gemini key's free per-minute limit, so this can take a few minutes."
                : 'Longer documents take more time.'}
            </span>
          </p>
        )}
        {error && (
          <div className="rounded-control border border-danger/25 bg-danger-soft p-3 text-xs text-danger-fg" role="alert">
            <p>{error.text}</p>
            {error.reload && <button type="button" onClick={load} className="mt-1 font-medium underline underline-offset-2">Try again</button>}
            {error.changeKey && onChangeKey && <button type="button" onClick={onChangeKey} className="mt-1 font-medium underline underline-offset-2">Enter key again</button>}
          </div>
        )}

        <button
          type="button" disabled={!!busy} onClick={() => fileInput.current?.click()}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-medium text-primary-fg shadow-ink transition-[background-color,transform] duration-200 ease-out hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
        >
          <Upload className="size-4" aria-hidden /> Upload a document
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
        <p className="text-center text-xs text-muted">PDF, .txt or .md, up to 25 MB</p>
      </div>
    </section>
  );
}
