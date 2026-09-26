import { useCallback, useSyncExternalStore } from 'react';

function mediaQuery(query: string): MediaQueryList | null {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
  } catch {
    return null;
  }
}

const serverSnapshot = () => false;

/**
 * Calls `onChange` with the new result each time `query` starts or stops
 * matching; returns the unsubscribe function. A no-op where matchMedia is missing.
 */
export function subscribeMediaQuery(query: string, onChange: (matches: boolean) => void): () => void {
  const list = mediaQuery(query);
  if (!list) return () => {};
  const listener = () => onChange(list.matches);
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', listener);
    return () => list.removeEventListener('change', listener);
  }
  // Safari before 14 only has the older API.
  list.addListener(listener);
  return () => list.removeListener(listener);
}

/** Whether `query` matches now; re-renders when that changes. False where matchMedia is missing. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => subscribeMediaQuery(query, onChange), [query]);
  const getSnapshot = useCallback(() => mediaQuery(query)?.matches ?? false, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}
