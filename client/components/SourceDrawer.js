'use client';

import { useEffect } from 'react';
import SourceViewer from './SourceViewer';

// Slides over the right side when a page chip or citation is clicked, so the main
// screen keeps its layout. Esc or the backdrop closes it.
export default function SourceDrawer({ source, apiKey, onClose }) {
  useEffect(() => {
    if (!source) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source, onClose]);

  if (!source) return null;
  return (
    <div className="fixed inset-0 z-20 flex justify-end" role="dialog" aria-modal="true" aria-label={`${source.docName}, page ${source.page}`}>
      <button type="button" className="absolute inset-0 cursor-default bg-black/35 backdrop-blur-[2px]" onClick={onClose} aria-label="Close the document" />
      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-border bg-surface shadow-lift sm:rounded-l-panel">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <p className="text-sm text-muted">The highlighted text is where the answer came from.</p>
          <button type="button" onClick={onClose} autoFocus className="h-9 shrink-0 rounded-full border border-border-strong px-4 text-sm font-medium transition-colors duration-200 hover:bg-surface-2">Close</button>
        </div>
        <div className="min-h-0 flex-1">
          <SourceViewer source={source} apiKey={apiKey} />
        </div>
      </div>
    </div>
  );
}
