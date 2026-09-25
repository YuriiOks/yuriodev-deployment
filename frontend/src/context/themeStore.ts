import type { Theme } from './theme-context';
import { readStorage, removeStorage, writeStorage } from '../utils/safeStorage';

/*
 * Theme state outside React, read through useSyncExternalStore.
 * public/theme-init.js applies the same rules before the first paint; keep the
 * storage key and the colours below in sync with it.
 */

/** Written only when the visitor presses the theme toggle. */
export const THEME_STORAGE_KEY = 'theme-choice';

/**
 * Earlier versions of the site wrote the theme in use under 'theme' on every
 * visit, chosen or not, so that value is not a choice and is ignored.
 */
const LEGACY_THEME_KEY = 'theme';

export function forgetLegacyTheme(): void {
  removeStorage('local', LEGACY_THEME_KEY);
}

/** Browser UI colour (meta theme-color) per theme: the page background. */
export const THEME_COLORS: Record<Theme, string> = { dark: '#0a0f1c', light: '#f8fafc' };

const LIGHT_QUERY = '(prefers-color-scheme: light)';

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

// --- the visitor's explicit choice (null until they toggle) ---------------

const choiceListeners = new Set<() => void>();

export function getStoredTheme(): Theme | null {
  const value = readStorage('local', THEME_STORAGE_KEY);
  return isTheme(value) ? value : null;
}

export function storeTheme(theme: Theme): void {
  writeStorage('local', THEME_STORAGE_KEY, theme);
  choiceListeners.forEach((listener) => listener());
}

export function subscribeStoredTheme(listener: () => void): () => void {
  choiceListeners.add(listener);
  // A choice made in another tab arrives as a storage event.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    choiceListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

// --- the operating system preference --------------------------------------

function lightQuery(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia(LIGHT_QUERY) : null;
  } catch {
    return null;
  }
}

export function getSystemTheme(): Theme {
  return lightQuery()?.matches ? 'light' : 'dark';
}

export function subscribeSystemTheme(listener: () => void): () => void {
  const query = lightQuery();
  if (!query) return () => {};
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }
  // Safari before 14 only has the older API.
  query.addListener(listener);
  return () => query.removeListener(listener);
}

// --- the document ---------------------------------------------------------

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', THEME_COLORS[theme]);
  });
}
