/**
 * localStorage / sessionStorage that never throw.
 *
 * Reading `window.localStorage` itself throws a SecurityError when site data
 * is blocked (some privacy modes, embedded webviews, strict cookie settings),
 * and setItem throws when the quota is full. A throw during the first render
 * would blank the whole site, so every access goes through here instead.
 * When the real storage is unusable, values live in memory for the rest of
 * the page's life, which is all the site needs (theme, "loader already shown").
 */

export type StorageKind = 'local' | 'session';

const memory: Record<StorageKind, Map<string, string>> = {
  local: new Map(),
  session: new Map(),
};

function area(kind: StorageKind): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStorage(kind: StorageKind, key: string): string | null {
  // A value kept in memory means the last write to real storage failed, so it
  // is newer than whatever real storage holds.
  const kept = memory[kind].get(key);
  if (kept !== undefined) return kept;
  try {
    return area(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Stores the value; returns false when only the in-memory copy could be kept. */
export function writeStorage(kind: StorageKind, key: string, value: string): boolean {
  try {
    const storage = area(kind);
    if (storage) {
      storage.setItem(key, value);
      memory[kind].delete(key);
      return true;
    }
  } catch {
    // keep it in memory below
  }
  memory[kind].set(key, value);
  return false;
}

export function removeStorage(kind: StorageKind, key: string): void {
  memory[kind].delete(key);
  try {
    area(kind)?.removeItem(key);
  } catch {
    // nothing else to clean up
  }
}

/** Test helper: forget the in-memory fallback values. */
export function resetStorageFallback(): void {
  memory.local.clear();
  memory.session.clear();
}
