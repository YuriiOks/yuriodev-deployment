import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useImageFallback } from './useImageFallback';

afterEach(() => vi.useRealTimers());

describe('the picture fallback', () => {
  it('fails at once, asks again once after the delay, and stays failed after a second failure until the address changes', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ address }) => useImageFallback(address, 5000), { initialProps: { address: '/a' } });
    expect(result.current).toMatchObject({ failed: false, attempt: 0 });
    act(() => result.current.onError());
    expect(result.current.failed).toBe(true);
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current).toMatchObject({ failed: false, attempt: 1 });
    act(() => result.current.onError());
    expect(result.current.failed).toBe(true);
    act(() => void vi.advanceTimersByTime(60000));
    expect(result.current.failed).toBe(true);
    rerender({ address: '/b' });
    expect(result.current).toMatchObject({ failed: false, attempt: 0 });
  });
});
