'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

// Horizontal bars on a 0-100% scale, grouped per row (one bar per series), growing from
// the left edge when scrolled into view. Thin marks with a 4px rounded end, square at the
// baseline, 2px between the bars of a group, the value printed past each bar's end.
// Hover or keyboard focus on a bar shows its row, series and value; the same numbers are
// in the table under the chart, so nothing depends on hover or on colour.
//   rows:   [{ key, label, note?, values: { [seriesKey]: 0..1 | null } }]
//   series: [{ key, label, color }]   color: a Tailwind bg class, e.g. 'bg-viz-1'
//   format: value -> text
export default function Bars({ rows, series, format, caption, labelWidth = 'sm:w-52' }) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState(null); // `${rowKey}:${seriesKey}`

  return (
    <figure>
      {series.length > 1 && (
        <figcaption className="mb-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
          <span className="sr-only">{caption}. </span>
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-2">
              <span className={`inline-block h-2.5 w-4 rounded-[3px] ${s.color}`} aria-hidden /> {s.label}
            </span>
          ))}
        </figcaption>
      )}
      {series.length === 1 && <figcaption className="sr-only">{caption}</figcaption>}

      <ul className="space-y-4">
        {rows.map((row, i) => (
          <li key={row.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
            <div className={`shrink-0 ${labelWidth}`}>
              <p className="text-sm font-medium leading-snug">{row.label}</p>
              {row.note && <p className="mt-0.5 text-xs leading-snug text-muted">{row.note}</p>}
            </div>
            <div className="relative min-w-0 flex-1 border-l border-viz-grid py-0.5 pr-16">
              <div className="flex flex-col gap-0.5">
                {series.map((s, j) => {
                  const v = row.values[s.key];
                  const id = `${row.key}:${s.key}`;
                  const text = format(v);
                  const width = `${Math.max(0, Math.min(1, v ?? 0)) * 100}%`;
                  return (
                    <div key={s.key} className="relative h-3">
                      {v != null && (
                        <motion.div
                          role="img"
                          tabIndex={0}
                          aria-label={`${row.label}, ${s.label}: ${text}`}
                          onPointerEnter={() => setHover(id)}
                          onPointerLeave={() => setHover((h) => (h === id ? null : h))}
                          onFocus={() => setHover(id)}
                          onBlur={() => setHover((h) => (h === id ? null : h))}
                          className={`absolute inset-y-0 left-0 rounded-r-[4px] outline-offset-2 transition-[filter] duration-150 ${s.color} ${hover === id ? 'brightness-110' : ''}`}
                          initial={reduce ? { width } : { width: 0 }}
                          whileInView={{ width }}
                          viewport={{ once: true, amount: 0.5 }}
                          transition={{ duration: 0.9, delay: reduce ? 0 : 0.1 + i * 0.09 + j * 0.05, ease: [0.22, 1, 0.36, 1] }}
                        />
                      )}
                      <motion.span
                        className="absolute top-1/2 -translate-y-1/2 pl-1.5 text-xs font-medium tabular-nums whitespace-nowrap text-fg"
                        style={{ left: width }}
                        initial={reduce ? { opacity: 1 } : { opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true, amount: 0.5 }}
                        transition={{ duration: 0.3, delay: reduce ? 0 : 0.7 + i * 0.09 + j * 0.05 }}
                        aria-hidden
                      >
                        {text}
                      </motion.span>
                      {hover === id && (
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 rounded-control border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lift"
                          style={{ left: `min(max(calc(${width} / 2), 4rem), calc(100% - 4rem))` }}
                        >
                          <span className="font-semibold text-fg">{text}</span>
                          <span className="text-muted"> · {s.label}</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <details className="mt-5 text-sm">
        <summary className="w-fit cursor-pointer select-none text-muted underline-offset-4 hover:underline">Show as a table</summary>
        <div className="relative mt-2 overflow-x-auto overscroll-contain">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th scope="col" className="py-1.5 pr-4 font-medium" />
                {series.map((s) => <th key={s.key} scope="col" className="py-1.5 pr-4 font-medium">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-border/60">
                  <th scope="row" className="py-1.5 pr-4 font-medium">{row.label}</th>
                  {series.map((s) => <td key={s.key} className="py-1.5 pr-4 tabular-nums">{format(row.values[s.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
