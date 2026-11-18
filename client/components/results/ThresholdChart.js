'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { nearest, pct, thresholdGeometry } from '@/lib/results';

const HEIGHT = 260;
const SERIES = [
  { key: 'answerableKept', label: 'Questions with an answer: still answered', stroke: 'var(--viz-1)', swatch: 'bg-viz-1' },
  { key: 'unanswerableCaught', label: 'Questions without one: stopped', stroke: 'var(--viz-2)', swatch: 'bg-viz-2' },
];

// What a hard cut-off on the search score would do: as the cut-off rises, more of the
// questions that have no answer are stopped, and more of the ones that do are lost too.
// Lines draw in when scrolled into view; a crosshair follows the pointer (or the arrow
// keys) and reads both values at the nearest cut-off. The table below holds every value.
// points: [{ threshold, answerableKept, unanswerableCaught }]; current: Anchor's setting.
export default function ThresholdChart({ points, current }) {
  const box = useRef(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState(null); // index into points
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const g = thresholdGeometry(points, { width, height: HEIGHT, pad: { top: 16, right: 18, bottom: 30, left: 44 } });
  if (!g) return null;
  const narrow = width < 480;
  const ticks = points.filter((p, i) => (narrow ? i % 2 === 1 : true));
  const hit = active == null ? null : g.positions[active];
  const currentX = current != null ? g.x(current) : null;

  const pick = (clientX) => {
    const rect = box.current.getBoundingClientRect();
    const p = nearest(g.positions, clientX - rect.left);
    setActive(g.positions.indexOf(p));
  };
  const onKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setActive((i) => {
      const start = i ?? points.findIndex((p) => p.threshold === current);
      return Math.max(0, Math.min(points.length - 1, (start < 0 ? 0 : start) + (e.key === 'ArrowRight' ? 1 : -1)));
    });
  };
  const draw = (delay) => (reduce
    ? { initial: { pathLength: 1 } }
    : { initial: { pathLength: 0 }, whileInView: { pathLength: 1 }, viewport: { once: true, amount: 0.4 }, transition: { duration: 1.2, delay, ease: 'easeInOut' } });

  return (
    <figure>
      <figcaption className="mb-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
        <span className="sr-only">What a hard cut-off on the search score would do. </span>
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            <span className={`inline-block h-0.5 w-5 rounded-full ${s.swatch}`} aria-hidden /> {s.label}
          </span>
        ))}
      </figcaption>

      <div
        ref={box}
        className="relative touch-pan-y outline-offset-4"
        tabIndex={0}
        role="group"
        aria-label="Cut-off chart. Use the left and right arrow keys to read the values at each cut-off."
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={HEIGHT} className="block overflow-visible" aria-hidden>
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line x1={g.pad.left} x2={width - g.pad.right} y1={g.y(v)} y2={g.y(v)} stroke="var(--viz-grid)" strokeWidth="1" />
              <text x={g.pad.left - 8} y={g.y(v)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">{pct(v, 0)}</text>
            </g>
          ))}
          {ticks.map((p) => (
            <text key={p.threshold} x={g.x(p.threshold)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted text-[11px] tabular-nums">{p.threshold}</text>
          ))}

          {currentX != null && (
            <g>
              <line x1={currentX} x2={currentX} y1={g.pad.top - 4} y2={HEIGHT - g.pad.bottom} stroke="var(--fg)" strokeOpacity="0.35" strokeWidth="1" />
              <text x={currentX + 6} y={g.y(0.75)} dy="0.32em" className="fill-fg text-[11px] font-medium">Anchor uses {current}</text>
            </g>
          )}

          {SERIES.map((s, i) => (
            <motion.path key={s.key} d={s.key === 'answerableKept' ? g.kept : g.caught} fill="none" stroke={s.stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" {...draw(0.15 + i * 0.25)} />
          ))}

          {hit && (
            <g>
              <line x1={hit.px} x2={hit.px} y1={g.pad.top} y2={HEIGHT - g.pad.bottom} stroke="var(--fg)" strokeOpacity="0.25" strokeWidth="1" />
              {SERIES.map((s) => (
                <circle key={s.key} cx={hit.px} cy={g.y(hit[s.key])} r="4.5" fill={s.stroke} stroke="var(--surface)" strokeWidth="2" />
              ))}
            </g>
          )}
        </svg>

        {hit && (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 w-56 rounded-control border border-border bg-surface px-3 py-2 text-xs shadow-lift"
            style={{ left: Math.min(Math.max(hit.px + 12, 0), width - 232) }}
          >
            <p className="font-semibold text-fg">Cut-off {hit.threshold}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="mt-1 flex items-center gap-2">
                <span className={`inline-block h-0.5 w-3 shrink-0 rounded-full ${s.swatch}`} aria-hidden />
                <span className="font-semibold tabular-nums text-fg">{pct(hit[s.key], 0)}</span>
                <span className="text-muted">{s.key === 'answerableKept' ? 'still answered' : 'stopped'}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <details className="mt-4 text-sm">
        <summary className="w-fit cursor-pointer select-none text-muted underline-offset-4 hover:underline">Show as a table</summary>
        <div className="relative mt-2 overflow-x-auto overscroll-contain">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th scope="col" className="py-1.5 pr-4 font-medium">Cut-off</th>
                <th scope="col" className="py-1.5 pr-4 font-medium">With an answer: still answered</th>
                <th scope="col" className="py-1.5 pr-4 font-medium">Without one: stopped</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.threshold} className="border-b border-border/60">
                  <th scope="row" className="py-1.5 pr-4 font-medium tabular-nums">{p.threshold}{p.threshold === current ? ' (Anchor)' : ''}</th>
                  <td className="py-1.5 pr-4 tabular-nums">{pct(p.answerableKept, 0)}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{pct(p.unanswerableCaught, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
