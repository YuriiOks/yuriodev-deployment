import { useEffect, useState } from 'react';
import { fetchEvents, type LiveEvent } from '../services/dashboards/liveApi';

export interface LiveEventsState {
  readonly status: 'loading' | 'ready' | 'error';
  /** The events of the range last answered; kept while the next range loads, so the grid never empties. */
  readonly events: readonly LiveEvent[];
  readonly reload: () => void;
}

interface Loaded {
  readonly key: string;
  readonly ok: boolean;
  readonly events: readonly LiveEvent[];
}

const NONE: readonly LiveEvent[] = [];

/** The events of every space between two dates (GET /events), fetched again when the range or `reload` changes. */
export function useLiveEvents(from: string, to: string, enabled: boolean): LiveEventsState {
  const [token, setToken] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${from}:${to}:${token}`;

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    fetchEvents(from, to, controller.signal).then(
      (events) => {
        if (!controller.signal.aborted) setLoaded({ key, ok: true, events });
      },
      () => {
        if (!controller.signal.aborted) setLoaded((previous) => ({ key, ok: false, events: previous?.events ?? NONE }));
      },
    );
    return () => controller.abort();
  }, [from, to, enabled, key]);

  const current = loaded && loaded.key === key ? loaded : null;
  return {
    status: current ? (current.ok ? 'ready' : 'error') : 'loading',
    events: loaded ? loaded.events : NONE,
    reload: () => setToken((value) => value + 1),
  };
}
