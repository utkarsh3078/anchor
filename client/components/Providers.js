'use client';

import { MotionConfig } from 'framer-motion';

// reducedMotion="user": Framer Motion drops movement for visitors who ask for less motion
export default function Providers({ children }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
