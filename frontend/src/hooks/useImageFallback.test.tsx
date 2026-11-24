import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useImageFallback } from './useImageFallback';

/** Puts the hook's wrapper in the page (in jsdom a box at the top: within reach). */
const attach = (hook: { result: { current: { ref: (element: Element | null) => void } } }) => act(() => hook.result.current.ref(document.createElement('span')));
const address = (name: string) => `/api/dashboards/v1/finance/providers/${name}/logo/mark?v=0a1b2c3d`;

afterEach(() => {
  vi.useRealTimers();
});

describe('the picture loader', () => {
  it('fails at once and is not asked again (no retries within a page view) until its address changes', () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(({ src }) => useImageFallback(src), { initialProps: { src: address('a') } });
    attach({ result });
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current).toMatchObject({ failed: false, attempt: 0, ready: true });
    act(() => result.current.onError());
    expect(result.current).toMatchObject({ failed: true, attempt: 1 });
    act(() => void vi.advanceTimersByTime(120000));
    expect(result.current.failed).toBe(true);
    rerender({ src: address('b') });
    expect(result.current).toMatchObject({ failed: false, attempt: 0 });
    unmount();
  });

  it('lets at most two pictures load at once, at most one turn every 100 ms, and hands the next turn on as one finishes; a data URI never waits', () => {
    vi.useFakeTimers();
    const hooks = Array.from({ length: 5 }, (_, index) => renderHook(() => useImageFallback(address(`p${index}`))));
    act(() => void vi.advanceTimersByTime(1000));
    hooks.forEach(attach);
    act(() => void vi.advanceTimersByTime(1000));
    expect(hooks.map((hook) => hook.result.current.ready)).toEqual([true, true, false, false, false]);
    // A turn given back is handed on at once when the gap since the last one has passed...
    act(() => hooks[0].result.current.onLoad());
    expect(hooks[2].result.current.ready).toBe(true);
    // ...and a turn right after it waits for its 100 ms.
    act(() => hooks[1].result.current.onError());
    expect(hooks[3].result.current.ready).toBe(false);
    act(() => void vi.advanceTimersByTime(50));
    expect(hooks[3].result.current.ready).toBe(false);
    act(() => void vi.advanceTimersByTime(100));
    expect(hooks[3].result.current.ready).toBe(true);
    expect(hooks[4].result.current.ready).toBe(false);
    const inline = renderHook(() => useImageFallback('data:image/png;base64,AAAA'));
    attach(inline);
    expect(inline.result.current.ready).toBe(true);
    for (const hook of hooks) hook.unmount();
    inline.unmount();
  });
});
