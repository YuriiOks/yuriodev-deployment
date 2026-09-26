import { useCallback, useState, useSyncExternalStore } from 'react';

/**
 * Whether an element is "mostly" on screen: at least `threshold` of its own
 * area inside the viewport. Kept outside React and read through
 * useSyncExternalStore, so no effect sets state.
 */
export interface VisibilityStore {
  /** Starts watching `element` (null: nothing to watch); returns the function that stops. */
  connect(element: Element | null, notify: () => void): () => void;
  snapshot(): boolean;
}

export function createVisibilityStore(threshold: number): VisibilityStore {
  let visible = false;
  const set = (next: boolean, notify: () => void) => {
    if (next === visible) return;
    visible = next;
    notify();
  };

  return {
    snapshot: () => visible,

    connect(element, notify) {
      if (!element || typeof IntersectionObserver === 'undefined') {
        set(false, notify);
        return () => {};
      }
      // Until the observer's first report, assume a freshly found element is
      // on screen (the hero is, when the page opens at the top).
      set(true, notify);
      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (entry) set(entry.isIntersecting && entry.intersectionRatio >= threshold, notify);
        },
        { threshold: [0, threshold, 1] },
      );
      observer.observe(element);
      return () => observer.disconnect();
    },
  };
}

const serverSnapshot = () => false;

/**
 * True while at least `threshold` of the element with `id` is on screen.
 * Pass null while the element is not on the page; pass its id once it is
 * (the hook finds it by id when `id` changes).
 */
export function useMostlyInView(id: string | null, threshold: number): boolean {
  const [store] = useState(() => createVisibilityStore(threshold));
  const subscribe = useCallback(
    (notify: () => void) => store.connect(id ? document.getElementById(id) : null, notify),
    [store, id],
  );
  return useSyncExternalStore(subscribe, store.snapshot, serverSnapshot);
}
