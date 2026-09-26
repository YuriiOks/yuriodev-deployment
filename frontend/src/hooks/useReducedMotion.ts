import { useSyncExternalStore } from 'react';
import { onMotionChange, prefersReducedMotion } from '../utils/motion';

const serverSnapshot = () => false;

/** True while the visitor asks for reduced motion; re-renders when that changes. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(onMotionChange, prefersReducedMotion, serverSnapshot);
}
