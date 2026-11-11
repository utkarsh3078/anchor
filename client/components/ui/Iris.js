// The iridescent gradient for icon strokes. IrisDefs is rendered once (app/layout.js);
// any lucide icon then takes it with color={IRIS}. userSpaceOnUse over lucide's 24-unit
// viewBox, so straight lines get the gradient too.
export const IRIS = 'url(#anchor-iris)';

export function IrisDefs() {
  return (
    <svg width="0" height="0" aria-hidden className="pointer-events-none absolute">
      <defs>
        <linearGradient id="anchor-iris" gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22">
          <stop offset="0" style={{ stopColor: 'var(--iris-1)' }} />
          <stop offset="0.4" style={{ stopColor: 'var(--iris-2)' }} />
          <stop offset="0.75" style={{ stopColor: 'var(--iris-3)' }} />
          <stop offset="1" style={{ stopColor: 'var(--iris-4)' }} />
        </linearGradient>
      </defs>
    </svg>
  );
}

// An icon on a soft tile, drawn with the gradient
export function IrisIcon({ icon: Icon, className = '' }) {
  return (
    <span className={`inline-flex size-11 items-center justify-center rounded-2xl bg-surface-2 ${className}`}>
      <Icon className="size-[22px]" color={IRIS} strokeWidth={2.2} aria-hidden />
    </span>
  );
}
