import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 63.99rem)';

const media = (): MediaQueryList | null => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null);

const subscribe = (listener: () => void): (() => void) => {
  const list = media();
  list?.addEventListener?.('change', listener);
  return () => list?.removeEventListener?.('change', listener);
};

/** The screen is narrower than 64rem (a phone or a small tablet): the wallet then puts the opened bank under its card. False when the browser cannot say. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches === true, () => false);
}
