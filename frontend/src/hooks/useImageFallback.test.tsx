import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useImageFallback } from './useImageFallback';

/** Puts the hook's wrapper in the page (in jsdom a box at the top: within reach). */
const attach = (hook: { result: { current: { ref: (element: Element | null) => void } } }) => act(() => hook.result.current.ref(document.createElement('span')));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the picture loader', () => {
  it('fails at once, asks again after about 2 s and about 6 s, then stays failed until the address changes', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { result, rerender } = renderHook(({ address }) => useImageFallback(address), { initialProps: { address: '/api/dashboards/v1/finance/providers/a/logo/mark?v=0a1b2c3d' } });
    attach({ result });
    expect(result.current).toMatchObject({ failed: false, attempt: 0, ready: true });
    act(() => result.current.onError());
    expect(result.current).toMatchObject({ failed: true, attempt: 1 });
    act(() => void vi.advanceTimersByTime(1900));
    expect(result.current.failed).toBe(true);
    act(() => void vi.advanceTimersByTime(200));
    expect(result.current).toMatchObject({ failed: false, attempt: 1, ready: true });
    act(() => result.current.onError());
    expect(result.current).toMatchObject({ failed: true, attempt: 2 });
    act(() => void vi.advanceTimersByTime(6100));
    expect(result.current).toMatchObject({ failed: false, attempt: 2 });
    act(() => result.current.onError());
    expect(result.current).toMatchObject({ failed: true, attempt: 3 });
    act(() => void vi.advanceTimersByTime(120000));
    expect(result.current.failed).toBe(true);
    rerender({ address: '/api/dashboards/v1/finance/providers/b/logo/mark?v=0a1b2c3d' });
    expect(result.current).toMatchObject({ failed: false, attempt: 0 });
  });

  it('lets at most six pictures load at once and starts the next as one finishes; an address that is not the API\'s (a data URI) never waits', () => {
    const hooks = Array.from({ length: 8 }, (_, index) => renderHook(() => useImageFallback(`/api/dashboards/v1/finance/providers/p${index}/logo/mark?v=0a1b2c3d`)));
    hooks.forEach(attach);
    expect(hooks.map((hook) => hook.result.current.ready)).toEqual([true, true, true, true, true, true, false, false]);
    act(() => hooks[0].result.current.onLoad());
    expect(hooks[6].result.current.ready).toBe(true);
    expect(hooks[7].result.current.ready).toBe(false);
    act(() => hooks[1].result.current.onError());
    expect(hooks[7].result.current.ready).toBe(true);
    const inline = renderHook(() => useImageFallback('data:image/png;base64,AAAA'));
    attach(inline);
    expect(inline.result.current.ready).toBe(true);
    for (const hook of hooks) hook.unmount();
    inline.unmount();
  });
});
