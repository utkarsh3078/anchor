'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL } from '@/lib/api';
import { findPassageItems } from '@/lib/highlight';

// Chunk ids are `${docId}_${chunkIndex}`
export const docIdOf = (chunkId) => chunkId.slice(0, chunkId.lastIndexOf('_'));

let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'; // copied to public/ on install
    return pdfjs;
  });
  return pdfjsPromise;
}

// One fetch per document per session. The file belongs to the key that uploaded it, so
// the key goes along in a header; that is also why "Open" uses a blob URL of the fetched
// file and not a plain link to the server (a link can't carry the header).
const files = new Map();
function loadFile(docId, apiKey) {
  if (!files.has(docId)) {
    files.set(docId, (async () => {
      const res = await fetch(`${API_URL}/api/documents/${docId}/file`, { headers: apiKey ? { 'X-Gemini-Key': apiKey } : {} });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Could not load the document (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (blob.type.includes('pdf')) {
        const pdfjs = await loadPdfjs();
        const data = new Uint8Array(await blob.arrayBuffer());
        return { kind: 'pdf', url, pdf: await pdfjs.getDocument({ data, verbosity: 0 }).promise, pdfjs };
      }
      return { kind: 'text', url, text: await blob.text() };
    })().catch((e) => {
      files.delete(docId); // allow a retry
      throw e;
    }));
  }
  return files.get(docId);
}

// Renders one PDF page to a canvas and draws boxes over the text items of the passage
function PdfPage({ file, pageNumber, passage, onPageCount }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const [boxes, setBoxes] = useState([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let cancelled = false;
    let task;
    (async () => {
      const { pdf, pdfjs } = file;
      onPageCount(pdf.numPages);
      const page = await pdf.getPage(pageNumber);
      const width = wrap.current?.clientWidth || 500;
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      const dpr = window.devicePixelRatio || 1;
      const c = canvas.current;
      c.width = Math.floor(viewport.width * dpr);
      c.height = Math.floor(viewport.height * dpr);
      task = page.render({ canvas: c, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await task.promise;
      if (cancelled) return;
      setSize({ width: viewport.width, height: viewport.height });

      const { items } = await page.getTextContent();
      const found = passage ? findPassageItems(items, passage) : [];
      const rects = found.map((i) => {
        const item = items[i];
        const tx = pdfjs.Util.transform(viewport.transform, item.transform);
        const h = Math.hypot(tx[2], tx[3]);
        return { left: tx[4], top: tx[5] - h, width: item.width * viewport.scale, height: h * 1.15 };
      });
      if (cancelled) return;
      setBoxes(rects);
      if (rects.length) {
        const top = Math.min(...rects.map((r) => r.top));
        wrap.current?.closest('[data-scroll]')?.scrollTo({ top: Math.max(0, top - 60), behavior: 'smooth' });
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [file, pageNumber, passage, onPageCount]);

  return (
    <div ref={wrap} className="relative w-full">
      <canvas ref={canvas} style={{ width: size.width || '100%', height: size.height || 'auto' }} className="block shadow" />
      {boxes.map((b, i) => (
        <div
          key={i}
          className="pointer-events-none absolute rounded-sm bg-yellow-300/40 ring-1 ring-yellow-500/40"
          style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
        />
      ))}
    </div>
  );
}

function TextDoc({ text, passage }) {
  const at = passage ? text.toLowerCase().indexOf(passage.slice(0, 80).toLowerCase()) : -1;
  if (at < 0) return <pre className="whitespace-pre-wrap font-sans text-sm">{text}</pre>;
  const end = Math.min(text.length, at + passage.length);
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm">
      {text.slice(0, at)}
      <mark ref={(el) => el?.scrollIntoView({ block: 'center' })} className="rounded-sm bg-highlight text-fg">{text.slice(at, end)}</mark>
      {text.slice(end)}
    </pre>
  );
}

// source = { id, docName, page, text } of a passage (citation or trace row); apiKey: the
// visitor's Gemini key (the file is served only to the key that uploaded it)
export default function SourceViewer({ source, apiKey }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(source?.page ?? 1);
  const [pageCount, setPageCount] = useState(null);
  const docId = source ? docIdOf(source.id) : null;

  useEffect(() => {
    setPage(source?.page ?? 1);
  }, [source]);

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    setFile(null);
    setError('');
    loadFile(docId, apiKey).then((f) => !cancelled && setFile(f), (e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [docId, apiKey]);

  if (!source) return <p className="p-4 text-sm text-muted">Click a citation or a passage in the trace to open its source here.</p>;

  const onCitedPage = page === source.page;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
        <span className="flex-1 truncate font-medium" title={source.docName}>{source.docName}</span>
        {file?.kind === 'pdf' && (
          <>
            <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="size-8 rounded-full border border-border-strong hover:bg-surface-2 disabled:opacity-40">‹</button>
            <span className="text-xs tabular-nums">p. {page}{pageCount ? ` / ${pageCount}` : ''}</span>
            <button type="button" aria-label="Next page" disabled={pageCount != null && page >= pageCount} onClick={() => setPage((p) => p + 1)} className="size-8 rounded-full border border-border-strong hover:bg-surface-2 disabled:opacity-40">›</button>
          </>
        )}
        {file && (
          <a href={file.kind === 'pdf' ? `${file.url}#page=${page}` : file.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent underline underline-offset-2">Open</a>
        )}
      </div>
      {file?.kind === 'pdf' && !onCitedPage && (
        <button type="button" onClick={() => setPage(source.page)} className="bg-accent-soft px-4 py-1.5 text-left text-xs text-accent-soft-fg">
          Back to the cited passage on p. {source.page}
        </button>
      )}
      <div data-scroll className="relative flex-1 overflow-y-auto overscroll-contain bg-surface-2 p-3">
        {error && (
          <div className="space-y-2 text-sm">
            <p className="text-danger-fg">{error}</p>
            <p className="text-xs text-muted">Passage text (p. {source.page}):</p>
            <blockquote className="whitespace-pre-wrap rounded-r-control border-l-4 border-highlight bg-surface p-3">{source.text}</blockquote>
          </div>
        )}
        {!error && !file && <p className="text-sm text-muted">Loading document…</p>}
        {file?.kind === 'pdf' && (
          <PdfPage file={file} pageNumber={page} passage={onCitedPage ? source.text : null} onPageCount={setPageCount} />
        )}
        {file?.kind === 'text' && <TextDoc text={file.text} passage={source.text} />}
      </div>
    </div>
  );
}
