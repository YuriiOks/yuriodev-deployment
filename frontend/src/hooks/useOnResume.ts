import { useEffect, useRef } from 'react';

/**
 * Calls `onResume` (with how long the tab was away, in ms) when a tab that was hidden becomes visible again, so a page left open
 * overnight or in a background tab can ask for what has gone out of date.
 */
export function useOnResume(enabled: boolean, onResume: (awayMs: number) => void): void {
  const latest = useRef(onResume);
  useEffect(() => {
    latest.current = onResume;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    let hiddenAt: number | null = null;
    const changed = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt === null) return;
      const away = Date.now() - hiddenAt;
      hiddenAt = null;
      latest.current(away);
    };
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, [enabled]);
}
