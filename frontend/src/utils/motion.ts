/**
 * Reduced-motion preference, for code that animates from JavaScript (canvas,
 * typewriter, smooth scrolling). CSS animations are covered by the
 * prefers-reduced-motion block in global.css.
 */

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function reducedMotionQuery(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
  } catch {
    return null;
  }
}

export function prefersReducedMotion(): boolean {
  return reducedMotionQuery()?.matches ?? false;
}

/** 'auto' (an instant jump) under reduced motion, otherwise 'smooth'. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

/** Calls `listener` with the new value whenever the preference changes; returns an unsubscribe. */
export function onMotionChange(listener: (reduced: boolean) => void): () => void {
  const query = reducedMotionQuery();
  if (!query) return () => {};
  const handler = () => listener(prefersReducedMotion());
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }
  // Safari before 14 only has the older API.
  query.addListener(handler);
  return () => query.removeListener(handler);
}
