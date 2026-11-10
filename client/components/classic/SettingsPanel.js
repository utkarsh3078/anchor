'use client';

const MODES = [
  { id: 'anchor', label: 'Anchor (recommended)' },
  { id: 'hybrid', label: 'Hybrid baseline' },
  { id: 'dense', label: 'Dense baseline' },
];

const field = 'w-full rounded border border-slate-300 px-2 py-1 text-sm';

// Everyday choices up front (mode, model); retrieval knobs under "Advanced". They also
// serve as evaluation controls (mode switch, threshold) for the paper.
export default function SettingsPanel({ settings, setSettings, models }) {
  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const anchor = settings.mode === 'anchor';

  return (
    <section className="space-y-3 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Settings</h2>

      <label className="block">
        Mode
        <select value={settings.mode} onChange={(e) => set({ mode: e.target.value })} className={field}>
          {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>

      <label className="block">
        Gemini model
        <select value={settings.model} onChange={(e) => set({ model: e.target.value })} className={field}>
          {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
        </select>
        <span className="text-xs text-slate-500">If a model runs out of free quota, pick another.</span>
      </label>

      <details className="rounded border border-slate-200 px-2 py-1">
        <summary className="cursor-pointer select-none text-slate-600">Advanced</summary>
        <div className="space-y-3 py-2">
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
                <span className="text-xs text-slate-500">Below this rerank score Anchor retries, then answers with a low-confidence warning.</span>
              </label>

              <label className="flex items-start gap-2">
                <input type="checkbox" checked={settings.strict} onChange={(e) => set({ strict: e.target.checked })} className="mt-1" />
                <span>
                  Strict: refuse below the threshold
                  <span className="block text-xs text-slate-500">Abstains instead of answering when evidence is weak (how the paper evaluates Anchor).</span>
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

              {settings.maxRetries > 0 && (
                <label className="block">
                  Rewrite model
                  <select value={settings.rewriteModel} onChange={(e) => set({ rewriteModel: e.target.value })} className={field}>
                    <option value="">Same as answer model</option>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                  </select>
                  <span className="text-xs text-slate-500">A different model uses a separate free-tier quota.</span>
                </label>
              )}
            </>
          )}
        </div>
      </details>
    </section>
  );
}
