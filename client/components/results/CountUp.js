'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, useInView, useReducedMotion } from 'framer-motion';

// A number that counts up from 0 the first time it scrolls into view. format(v) turns the
// running value into text. Screen readers get the final value only (the moving digits
// are hidden from them); reduced motion shows the final value at once.
export default function CountUp({ value, format, duration = 1.2, className }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);

  useEffect(() => {
    if (reduce) {
      setShown(value);
      return undefined;
    }
    if (!inView) return undefined;
    const controls = animate(0, value, { duration, ease: [0.22, 1, 0.36, 1], onUpdate: setShown });
    return () => controls.stop();
  }, [inView, reduce, value, duration]);

  return (
    <span ref={ref} className={className}>
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
