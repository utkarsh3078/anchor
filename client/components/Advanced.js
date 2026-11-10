'use client';

import { DEFAULTS, MODES, isDefault } from '@/lib/settings';

const field = 'mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm';
const heading = 'text-xs font-semibold uppercase tracking-wide text-slate-500';

// Collapsed by default. Everything the simple view hides lives here: the retrieval
// details under each answer (scores, weights, confidence, retries), the retrieval
// settings of the earlier three-panel view, the models, and changing the key.
export default function Advanced({
  models, choice, setChoice, settings, setSettings, showDetails, setShowDetails, onChangeKey,
}) {
  const setModel = (patch) => setChoice((c) => ({ ...c, ...patch }));
  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const anchor = settings.mode === 'anchor';
  const changed = !isDefault(settings);

  return (
    <details className="rounded border border-slate-200 px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none text-slate-600">
        Advanced
        {changed && <span className="ml-1 text-xs text-amber-700">(settings changed)</span>}
      </summary>
      <div className="space-y-5 pb-1 pt-3">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} className="mt-1" />
          <span>
            Show retrieval details
            <span className="block text-xs text-slate-500">
              Adds “Retrieval details” under each answer: routing weights, keyword and semantic
              results, fusion, rerank scores, the confidence check and retries.
            </span>
          </span>
        </label>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className={heading}>Retrieval</h3>
            <button
              onClick={() => setSettings({ ...DEFAULTS })} disabled={!changed}
              className="text-xs text-slate-600 underline disabled:no-underline disabled:opacity-40"
            >
              Reset
            </button>
          </div>

          <label className="block">
            Mode
            <select value={settings.mode} onChange={(e) => set({ mode: e.target.value })} className={field}>
              {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>

          <label className="block">
            Passages retrieved (k): {settings.k}
            <input type="range" min={3} max={15} value={settings.k} onChange={(e) => set({ k: Number(e.target.value) })} className="w-full" />
          </label>

          {anchor && (
            <>
              <label className="block">
                Confidence threshold: {settings.threshold.toFixed(2)}
                <input
                  type="range" min={0} max={0.6} step={0.05} value={settings.threshold}
                  onChange={(e) => set({ threshold: Number(e.target.value) })} className="w-full"
                />
                <span className="block text-xs text-slate-500">
                  Below this rerank score Anchor rewords the question and searches again, then answers
                  with a low-confidence note (or refuses, in strict mode).
                </span>
              </label>

              <label className="flex items-start gap-2">
                <input type="checkbox" checked={settings.strict} onChange={(e) => set({ strict: e.target.checked })} className="mt-1" />
                <span>
                  Strict: refuse below the threshold
                  <span className="block text-xs text-slate-500">How the paper evaluates Anchor.</span>
                </span>
              </label>

              <label className="block">
                Retries when evidence is weak
                <select value={settings.maxRetries} onChange={(e) => set({ maxRetries: Number(e.target.value) })} className={field}>
                  <option value={0}>0 (retry off)</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </label>
            </>
          )}
        </div>

        <div className="space-y-3">
          <h3 className={heading}>Models</h3>
          <label className="block">
            Model for answers
            <select value={choice.model} onChange={(e) => setModel({ model: e.target.value })} className={field}>
              {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
          </label>
          <label className="block">
            Model for rewording questions
            <select value={choice.rewriteModel} onChange={(e) => setModel({ rewriteModel: e.target.value })} className={field}>
              <option value="">Same as the answer model</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Each model has its own free limit. If one runs out, pick another.
            </span>
          </label>
        </div>

        <button onClick={onChangeKey} className="text-slate-600 underline">Use a different Gemini key</button>
      </div>
    </details>
  );
}
