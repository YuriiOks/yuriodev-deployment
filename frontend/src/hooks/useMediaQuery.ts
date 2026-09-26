import { useCallback, useSyncExternalStore } from 'react';

function mediaQuery(query: string): MediaQueryList | null {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
  } catch {
    return null;
  }
}

const serverSnapshot = () => false;

/** Whether `query` matches now; re-renders when that changes. False where matchMedia is missing. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaQuery(query);
      if (!list) return () => {};
      if (typeof list.addEventListener === 'function') {
        list.addEventListener('change', onChange);
        return () => list.removeEventListener('change', onChange);
      }
      // Safari before 14 only has the older API.
      list.addListener(onChange);
      return () => list.removeListener(onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => mediaQuery(query)?.matches ?? false, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}
