'use client';

import { motion, useReducedMotion } from 'framer-motion';

// The story in one loop: a page → a question → the passage is highlighted and lifts off
// the page → an answer that cites "p. 12". All parts share one clock (same duration and
// repeat) and differ only in their keyframe times, so they stay in sync.
const LOOP = 11; // seconds

// Every keyframe list has 6 values; index 3 is the "fully shown" one, used as the still
// frame for visitors who prefer reduced motion.
const SHOW = [0, 0, 1, 1, 0, 0];
const still = (keyframes) => Object.fromEntries(Object.entries(keyframes).map(([k, v]) => [k, v[3]]));

// Text lines of the page: [x, y, width]
const LINES = [
  [44, 104, 150], [44, 122, 168], [44, 140, 132], [44, 158, 160],
  [44, 236, 164], [44, 254, 140], [44, 272, 156], [44, 290, 96],
];
// The passage the answer comes from
const PASSAGE = [[44, 186, 168], [44, 204, 124]];

export default function HeroIllustration() {
  const reduce = useReducedMotion();
  const pick = (keyframes) => (reduce ? still(keyframes) : keyframes);
  const t = (times) => (reduce ? { duration: 0 } : { duration: LOOP, times, repeat: Infinity, ease: 'easeInOut' });

  // Times: shown from `inAt`, hidden from `outAt` (fractions of the loop)
  const fade = (inAt, outAt = 0.88) => [0, inAt, inAt + 0.05, outAt, outAt + 0.05, 1];

  return (
    <svg
      viewBox="0 0 440 360"
      role="img"
      aria-label="A question about a document is answered with the passage it came from, marked as page 12."
      className="h-auto w-full max-w-[460px]"
    >
      {/* The page */}
      <rect x="24" y="40" width="210" height="290" rx="14" className="fill-surface stroke-border" strokeWidth="1.5" />
      <rect x="44" y="68" width="96" height="10" rx="5" className="fill-border-strong" />
      {LINES.map(([x, y, w]) => (
        <rect key={y} x={x} y={y} width={w} height="7" rx="3.5" className="fill-border" />
      ))}

      {/* Highlight sweeping over the passage */}
      {PASSAGE.map(([x, y, w], i) => (
        <motion.rect
          key={y}
          x={x - 4} y={y - 5} width={w + 8} height="17" rx="5"
          className="fill-highlight"
          style={{ originX: 0 }}
          animate={pick({ scaleX: SHOW })}
          transition={t([0, 0.2 + i * 0.04, 0.28 + i * 0.04, 0.88, 0.93, 1])}
        />
      ))}
      {PASSAGE.map(([x, y, w]) => (
        <rect key={`t${y}`} x={x} y={y} width={w} height="7" rx="3.5" className="fill-border-strong" />
      ))}

      <text x="129" y="318" textAnchor="middle" className="fill-muted font-sans" fontSize="11">12</text>

      {/* The passage lifting off the page */}
      <motion.g
        animate={pick({ opacity: SHOW, x: [0, 0, 0, 22, 22, 0], y: [0, 0, 0, -10, -10, 0] })}
        transition={t([0, 0.34, 0.39, 0.46, 0.93, 1])}
      >
        <rect x="34" y="174" width="196" height="46" rx="10" className="fill-surface stroke-accent" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 8px 14px rgb(0 0 0 / 0.12))' }} />
        <rect x="44" y="183" width="168" height="8" rx="4" className="fill-highlight" />
        <rect x="44" y="201" width="124" height="8" rx="4" className="fill-highlight" />
      </motion.g>

      {/* Dotted path from the passage to the answer */}
      <motion.path
        d="M 238 196 C 290 196, 300 230, 300 252"
        fill="none" strokeWidth="2" strokeDasharray="2 6" strokeLinecap="round"
        className="stroke-accent"
        animate={pick({ pathLength: [0, 0, 0, 1, 1, 0], opacity: SHOW })}
        transition={t([0, 0.46, 0.47, 0.54, 0.9, 1])}
      />

      {/* Question */}
      <motion.g
        animate={pick({ opacity: SHOW, y: [8, 8, 0, 0, 0, 8] })}
        transition={t(fade(0.06))}
      >
        <rect x="214" y="44" width="202" height="44" rx="22" className="fill-primary" />
        <text x="315" y="71" textAnchor="middle" className="fill-primary-fg font-sans" fontSize="14" fontWeight="500">
          When is the final exam?
        </text>
      </motion.g>

      {/* Answer with its citation */}
      <motion.g
        animate={pick({ opacity: SHOW, y: [10, 10, 0, 0, 0, 10] })}
        transition={t(fade(0.54))}
      >
        <rect x="196" y="252" width="224" height="80" rx="14" className="fill-surface stroke-border" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 6px 16px rgb(0 0 0 / 0.08))' }} />
        <text x="214" y="279" className="fill-fg font-serif" fontSize="15">The final exam is on</text>
        <text x="214" y="298" className="fill-fg font-serif" fontSize="15">Monday, 14 May.</text>
        <motion.g
          animate={pick({ opacity: SHOW, scale: [0.7, 0.7, 1, 1, 1, 0.7] })}
          transition={t(fade(0.62))}
          style={{ originX: '50%', originY: '50%' }}
        >
          <rect x="214" y="306" width="46" height="18" rx="9" className="fill-accent-soft" />
          <text x="237" y="319" textAnchor="middle" className="fill-accent-soft-fg font-sans" fontSize="11" fontWeight="600">p. 12</text>
        </motion.g>
      </motion.g>
    </svg>
  );
}
