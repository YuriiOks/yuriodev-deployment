import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVisibilityStore } from './useMostlyInView';

let callback: IntersectionObserverCallback = () => {};
const disconnect = vi.fn();
const originalObserver = window.IntersectionObserver;

function useDrivenObserver() {
  window.IntersectionObserver = class {
    constructor(cb: IntersectionObserverCallback) {
      callback = cb;
    }
    observe() {}
    unobserve() {}
    disconnect = disconnect;
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

const entry = (isIntersecting: boolean, intersectionRatio: number) =>
  [{ isIntersecting, intersectionRatio } as IntersectionObserverEntry];

afterEach(() => {
  window.IntersectionObserver = originalObserver;
  disconnect.mockClear();
});

describe('createVisibilityStore', () => {
  it('reports whether at least the threshold share is on screen, notifying only on change', () => {
    useDrivenObserver();
    const store = createVisibilityStore(0.4);
    const notify = vi.fn();
    store.connect(document.createElement('div'), notify);
    // Assumed on screen until the first report.
    expect(store.snapshot()).toBe(true);
    notify.mockClear();

    callback(entry(true, 0.5), {} as IntersectionObserver);
    expect(notify).not.toHaveBeenCalled();

    callback(entry(true, 0.2), {} as IntersectionObserver);
    expect(store.snapshot()).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);

    callback(entry(false, 0), {} as IntersectionObserver);
    expect(notify).toHaveBeenCalledTimes(1);

    callback(entry(true, 0.4), {} as IntersectionObserver);
    expect(store.snapshot()).toBe(true);
  });

  it('with nothing to watch, reports false', () => {
    useDrivenObserver();
    const store = createVisibilityStore(0.4);
    store.connect(document.createElement('div'), () => {});
    const notify = vi.fn();
    store.connect(null, notify);
    expect(store.snapshot()).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('disconnects its observer when it stops', () => {
    useDrivenObserver();
    const stop = createVisibilityStore(0.4).connect(document.createElement('div'), () => {});
    stop();
    expect(disconnect).toHaveBeenCalled();
  });
});
