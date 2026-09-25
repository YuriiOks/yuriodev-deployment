import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStorage, removeStorage, resetStorageFallback, writeStorage } from './safeStorage';

afterEach(() => {
  vi.restoreAllMocks();
  resetStorageFallback();
  localStorage.clear();
  sessionStorage.clear();
});

describe('safeStorage', () => {
  it('reads and writes the real storage when it works', () => {
    expect(writeStorage('local', 'k', 'v')).toBe(true);
    expect(localStorage.getItem('k')).toBe('v');
    expect(readStorage('local', 'k')).toBe('v');

    expect(writeStorage('session', 's', '1')).toBe(true);
    expect(sessionStorage.getItem('s')).toBe('1');

    removeStorage('local', 'k');
    expect(readStorage('local', 'k')).toBeNull();
  });

  it('returns null for a missing key', () => {
    expect(readStorage('local', 'missing')).toBeNull();
  });

  it('never throws when accessing storage itself throws (blocked site data)', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(() => readStorage('local', 'theme')).not.toThrow();
    expect(readStorage('local', 'theme')).toBeNull();
    expect(writeStorage('local', 'theme', 'light')).toBe(false);
    // Kept in memory for the rest of the page's life.
    expect(readStorage('local', 'theme')).toBe('light');
    expect(() => removeStorage('local', 'theme')).not.toThrow();
    expect(readStorage('local', 'theme')).toBeNull();
  });

  it('keeps a value in memory when setItem throws (quota full)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });

    expect(writeStorage('session', 'appLoaded', 'true')).toBe(false);
    expect(readStorage('session', 'appLoaded')).toBe('true');
  });

  it('never throws when getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('broken');
    });
    expect(readStorage('local', 'theme')).toBeNull();
  });
});
