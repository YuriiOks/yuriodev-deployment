import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { onMotionChange, prefersReducedMotion, scrollBehavior } from './motion';
import useTypewriter from '../hooks/useTypewriter';

const original = window.matchMedia;

/** A matchMedia whose prefers-reduced-motion answer the test can change. */
function mockReducedMotion(initiallyReduced: boolean) {
  let reduced = initiallyReduced;
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('prefers-reduced-motion: reduce') ? reduced : false;
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    addListener: (cb: () => void) => listeners.add(cb),
    removeListener: (cb: () => void) => listeners.delete(cb),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      reduced = next;
      act(() => listeners.forEach((cb) => cb()));
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  window.matchMedia = original;
  vi.useRealTimers();
});

describe('motion utilities', () => {
  it('report full motion by default', () => {
    mockReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe('smooth');
  });

  it('report reduced motion and an instant scroll when the OS asks for it', () => {
    mockReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe('auto');
  });

  it('notify subscribers of changes until they unsubscribe', () => {
    const media = mockReducedMotion(false);
    const listener = vi.fn();
    const unsubscribe = onMotionChange(listener);

    media.set(true);
    expect(listener).toHaveBeenLastCalledWith(true);
    media.set(false);
    expect(listener).toHaveBeenLastCalledWith(false);

    unsubscribe();
    expect(media.listenerCount()).toBe(0);
  });

  it('never throw when matchMedia is missing', () => {
    // @ts-expect-error: simulate an environment without matchMedia
    window.matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(false);
    expect(() => onMotionChange(() => {})()).not.toThrow();
  });
});

describe('useTypewriter', () => {
  const messages = ['First message...', 'Second message...'];

  it('types the first message character by character', () => {
    mockReducedMotion(false);
    vi.useFakeTimers();
    const { result } = renderHook(() => useTypewriter(messages));
    expect(result.current).toBe('');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('F');
    // Each character schedules the next one after React re-renders.
    for (let i = 0; i < 3; i++) {
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }
    expect(result.current).toBe('Firs');
  });

  it('shows the first message in full, without animating, under reduced motion', () => {
    mockReducedMotion(true);
    vi.useFakeTimers();
    const { result } = renderHook(() => useTypewriter(messages));
    expect(result.current).toBe('First message...');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe('First message...');
    expect(vi.getTimerCount()).toBe(0);
  });
});
