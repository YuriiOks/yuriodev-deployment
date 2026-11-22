import { useEffect, useSyncExternalStore } from 'react';
import { ensureBootstrap, getBootstrapSnapshot, subscribeBootstrap } from '../services/dashboards/bootstrapStore';
import type { LiveArea } from '../services/dashboards/liveApi';

export type DashboardMode = 'loading' | 'sample' | 'live';

export interface DashboardModeState {
  /** `loading` only until the first answer: after that the dashboards are on the API (`live`) or the sample data. */
  readonly mode: DashboardMode;
  /** The personal space's life areas (live only). */
  readonly areas: readonly LiveArea[];
  /** The server's clock at the answer, if it sent one. */
  readonly serverTime: string | null;
}

const NO_AREAS: readonly LiveArea[] = [];

/** Reads (and, on first use, asks for) the bootstrap answer: which data the dashboards run on. */
export function useDashboardMode(): DashboardModeState {
  const snapshot = useSyncExternalStore(subscribeBootstrap, getBootstrapSnapshot, getBootstrapSnapshot);
  useEffect(() => {
    ensureBootstrap();
  }, []);
  if (snapshot.status !== 'ready') return { mode: 'loading', areas: NO_AREAS, serverTime: null };
  if (snapshot.bootstrap?.enabled) {
    return { mode: 'live', areas: snapshot.bootstrap.areas, serverTime: snapshot.bootstrap.serverTime };
  }
  return { mode: 'sample', areas: NO_AREAS, serverTime: null };
}
