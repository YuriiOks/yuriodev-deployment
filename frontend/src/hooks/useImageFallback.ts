import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Pictures that come from the API (bank logos and marks, payment icons) share one loader: at most MAX_ACTIVE are in flight at once and the rest
 * wait their turn, so a page with dozens of them does not trip the proxy's request-rate limit. Their addresses carry a version and the server lets
 * the browser keep them for a day, so nothing here ever adds a cache-busting parameter: after the first success a reload costs nothing.
 */
const MAX_ACTIVE = 6;
let active = 0;
const waiting: (() => void)[] = [];

function pump(): void {
  while (active < MAX_ACTIVE && waiting.length > 0) {
    const grant = waiting.shift();
    active += 1;
    grant?.();
  }
}

/** Asks for a turn; `grant` runs when there is one (and `release` must then be called). The returned function withdraws a request that has not been granted. */
function requestSlot(grant: () => void): () => void {
  waiting.push(grant);
  pump();
  return () => {
    const index = waiting.indexOf(grant);
    if (index >= 0) waiting.splice(index, 1);
  };
}

function release(): void {
  active = Math.max(0, active - 1);
  pump();
}

/** How long to wait before asking again after the first and the second failure, with jitter so a burst of failures does not retry all at once. */
const RETRY_AFTER_MS = [2000, 6000] as const;
const jitter = (ms: number): number => ms * (0.75 + Math.random() * 0.5);

interface State {
  readonly address: string | null | undefined;
  /** How many times this address has failed. */
  readonly failures: number;
  /** The last attempt failed and the next one (if any) has not started. */
  readonly errored: boolean;
  /** This attempt has its turn at the loader. */
  readonly granted: boolean;
}

/**
 * What an <img> needs to be a good citizen: `ready` (it may be given its address now: only once it is near the screen and has a turn at the shared
 * loader), `ref` (put it on a wrapper, to know when the picture is near the screen), `onLoad` and `onError`. A picture that fails is `failed` at
 * once, so the page shows the name or the letter tile instead of a broken-image box, and is asked for again after about 2 s and again after about 6 s
 * (`attempt` changes, so the <img> is created again); after that it stays failed until its address changes.
 */
export function useImageFallback(address: string | null | undefined): { failed: boolean; attempt: number; ready: boolean; ref: (element: Element | null) => void; onLoad: () => void; onError: () => void } {
  const [state, setState] = useState<State>({ address, failures: 0, errored: false, granted: false });
  const current: State = state.address === address ? state : { address, failures: 0, errored: false, granted: false };
  const queued = typeof address === 'string' && address.startsWith('/');
  const holding = useRef(false);
  const [element, setElement] = useState<Element | null>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  const ref = useCallback((node: Element | null) => setElement(node), []);

  // Near the screen: nothing is asked for before it is about to be seen.
  useEffect(() => {
    if (near || !element) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, near]);

  // A turn at the shared loader.
  useEffect(() => {
    if (!queued || !near || current.errored || current.granted) return undefined;
    return requestSlot(() => {
      holding.current = true;
      setState((previous) => (previous.address === address ? { ...previous, granted: true } : { address, failures: 0, errored: false, granted: true }));
    });
  }, [queued, near, current.errored, current.granted, address]);

  // The failed attempt waits, then asks again.
  useEffect(() => {
    if (!current.errored || current.failures > RETRY_AFTER_MS.length) return undefined;
    const timer = setTimeout(() => setState({ address, failures: current.failures, errored: false, granted: false }), jitter(RETRY_AFTER_MS[current.failures - 1]));
    return () => clearTimeout(timer);
  }, [current.errored, current.failures, address]);

  // A turn still held when the picture goes away is given back.
  useEffect(
    () => () => {
      if (holding.current) {
        holding.current = false;
        release();
      }
    },
    [],
  );

  const done = () => {
    if (holding.current) {
      holding.current = false;
      release();
    }
  };
  return {
    failed: current.errored,
    attempt: current.failures,
    ready: near && (!queued || current.granted),
    ref,
    onLoad: done,
    onError: () => {
      done();
      setState({ address, failures: current.failures + 1, errored: true, granted: false });
    },
  };
}
