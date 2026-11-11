'use client';

import { DEFAULTS, MODES, isDefault } from '@/lib/settings';

const field =
  'mt-1.5 h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-sm';
const hint = 'mt-1 block text-sm font-normal text-muted';
const section = 'rounded-card border border-border bg-surface p-5 shadow-soft sm:p-6';
const check = 'mt-0.5 size-[18px] shrink-0 accent-primary';

// The Settings screen. Everything the ask screen hides lives here: the retrieval details
// under each answer (scores, weights, confidence, retries), the retrieval settings of the
// earlier three-panel view, the models, and changing the key.
export default function SettingsView({
  className = '', models, choice, setChoice, settings, setSettings, showDetails, setShowDetails, onChangeKey,
}) {
  const setModel = (patch) => setChoice((c) => ({ ...c, ...patch }));
  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const anchor = settings.mode === 'anchor';
  const changed = !isDefault(settings);

  return (
    <main className={`${className} overflow-y-auto px-4 py-6 sm:px-8 lg:py-10`}>
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1.5 text-muted">The defaults work well. Change these to see how Anchor finds its answers.</p>

        <div className="mt-6 space-y-4">
          <section className={section} aria-labelledby="set-answers">
            <h2 id="set-answers" className="text-lg font-semibold">Answers</h2>
            <label className="mt-4 flex cursor-pointer items-start gap-3 font-medium">
              <input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} className={check} />
              <span>
                Show retrieval details
                <span className={hint}>
                  Adds “Retrieval details” under each answer: routing weights, keyword and semantic
                  results, fusion, rerank scores, the confidence check and retries.
                </span>
              </span>
            </label>
          </section>

          <section className={section} aria-labelledby="set-retrieval">
            <div className="flex items-center justify-between gap-3">
              <h2 id="set-retrieval" className="text-lg font-semibold">
                Retrieval
                {changed && <span className="ml-2 rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-medium text-warn-fg">settings changed</span>}
              </h2>
              <button
                type="button" onClick={() => setSettings({ ...DEFAULTS })} disabled={!changed}
                className="h-9 rounded-full border border-border-strong px-4 text-sm font-medium transition-colors duration-200 hover:bg-surface-2 disabled:opacity-40"
              >
                Reset
              </button>
            </div>

            <div className="mt-4 space-y-5 font-medium">
              <label className="block">
                Mode
                <select value={settings.mode} onChange={(e) => set({ mode: e.target.value })} className={field}>
                  {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>

              <label className="block">
                Passages retrieved (k): {settings.k}
                <input
                  type="range" min={3} max={15} value={settings.k} onChange={(e) => set({ k: Number(e.target.value) })}
                  className="mt-2 block w-full accent-primary"
                />
              </label>

              {anchor && (
                <>
                  <label className="block">
                    Confidence threshold: {settings.threshold.toFixed(2)}
                    <input
                      type="range" min={0} max={0.6} step={0.05} value={settings.threshold}
                      onChange={(e) => set({ threshold: Number(e.target.value) })} className="mt-2 block w-full accent-primary"
                    />
                    <span className={hint}>
                      Below this rerank score Anchor rewords the question and searches again, then answers
                      with a low-confidence note (or refuses, in strict mode).
                    </span>
                  </label>

                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={settings.strict} onChange={(e) => set({ strict: e.target.checked })} className={check} />
                    <span>
                      Strict: refuse below the threshold
                      <span className={hint}>How the paper evaluates Anchor.</span>
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
          </section>

          <section className={section} aria-labelledby="set-models">
            <h2 id="set-models" className="text-lg font-semibold">Models</h2>
            <div className="mt-4 space-y-5 font-medium">
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
                <span className={hint}>Each model has its own free limit. If one runs out, pick another.</span>
              </label>
            </div>
          </section>

          <section className={section} aria-labelledby="set-key">
            <h2 id="set-key" className="text-lg font-semibold">Gemini key</h2>
            <p className="mt-1 text-sm text-muted">
              Your key stays in this browser tab and is sent to Anchor only with your requests. Anchor never saves it.
            </p>
            <button
              type="button" onClick={onChangeKey}
              className="mt-4 h-10 rounded-full border border-border-strong px-4 text-sm font-medium transition-colors duration-200 hover:bg-surface-2"
            >
              Use a different Gemini key
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}
