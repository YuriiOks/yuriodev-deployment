import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHorizontalScrollFade } from './useHorizontalScrollFade';

/** A div stubbed with the given scroll geometry (jsdom lays nothing out). */
function scrollableDiv(scrollWidth: number, clientWidth: number, scrollLeft = 0) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  el.scrollLeft = scrollLeft;
  document.body.appendChild(el);
  return el;
}

describe('useHorizontalScrollFade', () => {
  it('is false when the content never overflows', () => {
    const el = scrollableDiv(300, 300);
    const { result } = renderHook(() => useHorizontalScrollFade({ current: el }));
    expect(result.current).toBe(false);
  });

  it('is true at the start of an overflowing box, and false once scrolled to the end', () => {
    const el = scrollableDiv(600, 300, 0);
    const { result } = renderHook(() => useHorizontalScrollFade({ current: el }));
    expect(result.current).toBe(true);

    act(() => {
      el.scrollLeft = 300;
      el.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(false);

    act(() => {
      el.scrollLeft = 150;
      el.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(true);
  });

  it('is false with nothing to measure yet', () => {
    const { result } = renderHook(() => useHorizontalScrollFade({ current: null }));
    expect(result.current).toBe(false);
  });
});
