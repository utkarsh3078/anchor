'use client';

import { useEffect } from 'react';
import SourceViewer from './SourceViewer';

// Slides over the right side when a page chip or citation is clicked, so the main
// screen stays two panels. Esc or the backdrop closes it.
export default function SourceDrawer({ source, onClose }) {
  useEffect(() => {
    if (!source) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source, onClose]);

  if (!source) return null;
  return (
    <div className="fixed inset-0 z-20 flex justify-end" role="dialog" aria-modal="true" aria-label={`${source.docName}, page ${source.page}`}>
      <button className="absolute inset-0 cursor-default bg-slate-900/30" onClick={onClose} aria-label="Close the document" />
      <div className="relative flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <p className="text-sm text-slate-600">The highlighted text is where the answer came from.</p>
          <button onClick={onClose} autoFocus className="rounded border border-slate-300 px-3 py-1 text-sm">Close</button>
        </div>
        <div className="min-h-0 flex-1">
          <SourceViewer source={source} />
        </div>
      </div>
    </div>
  );
}
