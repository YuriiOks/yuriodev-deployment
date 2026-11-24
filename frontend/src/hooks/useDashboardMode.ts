import { useEffect, useSyncExternalStore } from 'react';
import { ensureBootstrap, getBootstrapSnapshot, subscribeBootstrap } from '../services/dashboards/bootstrapStore';
import type { LiveArea, LiveProjectRef } from '../services/dashboards/liveApi';

/**
 * `loading` until the first answer; then `live` (the API is on), `sample` (the server answered `enabled: false`: no database is
 * configured, so the page is a demo and says so), or `unreachable` (the server did not answer, or answered something that is not a
 * bootstrap: the real site never shows the bundled sample data for that; it says so and offers a retry).
 */
export type DashboardMode = 'loading' | 'sample' | 'live' | 'unreachable';

export interface DashboardModeState {
  /** `loading` only until the first answer: after that the dashboards are on the API (`live`) or the sample data. */
  readonly mode: DashboardMode;
  /** The personal space's life areas (live only). */
  readonly areas: readonly LiveArea[];
  /** The server's clock at the answer, if it sent one. */
  readonly serverTime: string | null;
  /** The projects the server listed (not archived), as of the bootstrap. */
  readonly projects: readonly LiveProjectRef[];
}

const NO_AREAS: readonly LiveArea[] = [];
const NO_PROJECTS: readonly LiveProjectRef[] = [];

/** Reads (and, on first use, asks for) the bootstrap answer: which data the dashboards run on. */
export function useDashboardMode(): DashboardModeState {
  const snapshot = useSyncExternalStore(subscribeBootstrap, getBootstrapSnapshot, getBootstrapSnapshot);
  useEffect(() => {
    ensureBootstrap();
  }, []);
  if (snapshot.status !== 'ready') return { mode: 'loading', areas: NO_AREAS, serverTime: null, projects: NO_PROJECTS };
  if (snapshot.bootstrap?.enabled) {
    return { mode: 'live', areas: snapshot.bootstrap.areas, serverTime: snapshot.bootstrap.serverTime, projects: snapshot.bootstrap.projects };
  }
  if (snapshot.bootstrap === null) return { mode: 'unreachable', areas: NO_AREAS, serverTime: null, projects: NO_PROJECTS };
  return { mode: 'sample', areas: NO_AREAS, serverTime: null, projects: NO_PROJECTS };
}
