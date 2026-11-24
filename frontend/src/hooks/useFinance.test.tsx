import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useOnce } from './useFinance';

describe('useOnce', () => {
  it('lets whoever asks for a reload wait until the new answer is in', async () => {
    let calls = 0;
    const resolvers: ((value: string) => void)[] = [];
    const load = () =>
      new Promise<string>((resolve) => {
        calls += 1;
        resolvers.push(resolve);
      });
    const { result } = renderHook(() => useOnce(load, true));
    await waitFor(() => expect(calls).toBe(1));
    act(() => resolvers[0]('first'));
    await waitFor(() => expect(result.current.value).toBe('first'));

    let settled = false;
    let reloading: Promise<void> = Promise.resolve();
    act(() => {
      reloading = result.current.reload().then(() => {
        settled = true;
      });
    });
    await waitFor(() => expect(calls).toBe(2));
    // Asked for, not answered: still waiting.
    expect(settled).toBe(false);
    await act(async () => {
      resolvers[1]('second');
      await reloading;
    });
    expect(settled).toBe(true);
    expect(result.current.value).toBe('second');
  });

  it('settles a reload too when the answer is a failure, and when a later reload replaces it', async () => {
    const outcomes: ('fail' | 'ok')[] = ['ok', 'fail', 'ok'];
    let index = 0;
    const load = () => {
      const outcome = outcomes[index++] ?? 'ok';
      return outcome === 'fail' ? Promise.reject(new Error('down')) : Promise.resolve('fine');
    };
    const { result } = renderHook(() => useOnce(load, true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    // The reload is asked for in one step (so its effect runs) and awaited in the next.
    let failing: Promise<void> = Promise.resolve();
    act(() => {
      failing = result.current.reload();
    });
    await act(async () => {
      await failing;
    });
    expect(result.current.status).toBe('error');
    let both: Promise<unknown> = Promise.resolve();
    act(() => {
      both = Promise.all([result.current.reload(), result.current.reload()]);
    });
    await act(async () => {
      await both;
    });
    expect(result.current.status).toBe('ready');
  });
});
