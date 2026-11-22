import { useEffect, useState } from 'react';
import { fetchSummary, type LiveSummary } from '../services/dashboards/liveApi';

export interface LiveSummaryState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly summary: LiveSummary | null;
  readonly reload: () => void;
}

interface Loaded {
  readonly token: number;
  readonly summary: LiveSummary | null;
}

/** The counters and next events of the three spaces (GET /summary), asked for on mount and on `reload`. */
export function useLiveSummary(): LiveSummaryState {
  const [token, setToken] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchSummary(controller.signal).then(
      (summary) => {
        if (!controller.signal.aborted) setLoaded({ token, summary });
      },
      () => {
        if (!controller.signal.aborted) setLoaded({ token, summary: null });
      },
    );
    return () => controller.abort();
  }, [token]);

  const current = loaded && loaded.token === token ? loaded : null;
  return {
    status: current ? (current.summary ? 'ready' : 'error') : 'loading',
    summary: current ? current.summary : null,
    reload: () => setToken((value) => value + 1),
  };
}
