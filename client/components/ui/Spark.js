import { useId } from 'react';

// One petal pointing up from the centre; the rays are a thin four-point star
const PETAL = 'M0,0 C36,-26 31,-70 0,-106 C-31,-70 -36,-26 0,0 Z';
const RAYS = 'M0,-118 C2,-14 14,-2 118,0 C14,2 2,14 0,118 C-2,14 -14,2 -118,0 C-14,-2 -2,-14 0,-118 Z';

// Anchor's mark of "something is being worked out": a soft iridescent four-point spark.
// Decorative (aria-hidden). busy speeds the animation up while an answer is on its way.
export default function Spark({ className = 'size-28', busy = false }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg viewBox="-120 -120 240 240" aria-hidden className={`${className} ${busy ? 'spark-busy' : ''}`}>
      <defs>
        <linearGradient id={`${id}p`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="-106">
          <stop offset="0" style={{ stopColor: 'var(--iris-1)' }} />
          <stop offset="0.4" style={{ stopColor: 'var(--iris-2)' }} stopOpacity="0.7" />
          <stop offset="0.75" style={{ stopColor: 'var(--iris-3)' }} stopOpacity="0.6" />
          <stop offset="1" style={{ stopColor: 'var(--iris-4)' }} stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id={`${id}r`} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="116">
          <stop offset="0" style={{ stopColor: 'var(--iris-1)' }} />
          <stop offset="0.45" style={{ stopColor: 'var(--iris-3)' }} stopOpacity="0.75" />
          <stop offset="1" style={{ stopColor: 'var(--iris-4)' }} stopOpacity="0.15" />
        </radialGradient>
        <radialGradient id={`${id}g`} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="92">
          <stop offset="0" style={{ stopColor: 'var(--iris-1)' }} stopOpacity="0.55" />
          <stop offset="0.6" style={{ stopColor: 'var(--iris-2)' }} stopOpacity="0.18" />
          <stop offset="1" style={{ stopColor: 'var(--iris-3)' }} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle r="92" fill={`url(#${id}g)`} />
      <path d={RAYS} fill={`url(#${id}r)`} className="spark-rays" />
      <g className="spark-petals">
        {[0, 90, 180, 270].map((turn) => (
          <path key={turn} d={PETAL} fill={`url(#${id}p)`} transform={`rotate(${turn})`} />
        ))}
        <circle r="11" fill="#fff" opacity="0.6" />
      </g>
    </svg>
  );
}
