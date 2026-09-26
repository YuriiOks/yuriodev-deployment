import { readStorage, removeStorage, writeStorage } from './safeStorage';

/*
 * Whether single-key shortcuts (?, J, K, T) are on. Visitors who use speech
 * input or a switch device can turn them off in the help panel (WCAG 2.1.4);
 * the choice is kept in localStorage. On unless turned off.
 */

export const SHORTCUTS_STORAGE_KEY = 'shortcuts';
const OFF = 'off';

const listeners = new Set<() => void>();

export function singleKeyShortcutsEnabled(): boolean {
  return readStorage('local', SHORTCUTS_STORAGE_KEY) !== OFF;
}

export function setSingleKeyShortcutsEnabled(enabled: boolean): void {
  if (enabled) removeStorage('local', SHORTCUTS_STORAGE_KEY);
  else writeStorage('local', SHORTCUTS_STORAGE_KEY, OFF);
  listeners.forEach((listener) => listener());
}

export function subscribeShortcutsPreference(listener: () => void): () => void {
  listeners.add(listener);
  // A change made in another tab arrives as a storage event.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SHORTCUTS_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
