import { clearBarCache, readBarCache, writeBarCache } from './barCache';
import { fetchBootstrap, type Bootstrap, type LiveProjectRef } from './liveApi';

/*
 * Whether the dashboards run on the API or on the bundled sample data, decided once per page load: the first
 * dashboards page asks GET /bootstrap, everything after reads the answer. `enabled: true` is real data; `enabled: false` is a
 * server with no database, which is the labelled demo on the bundled sample data; a network error, a non-2xx answer or a
 * non-JSON body (a null answer) is an unreachable server, never the sample data.
 */

export type BootstrapStatus = 'idle' | 'loading' | 'ready';

export interface BootstrapSnapshot {
  readonly status: BootstrapStatus;
  /** The answer, or null when there was none (a failure) or it has not come yet. */
  readonly bootstrap: Bootstrap | null;
}

const IDLE: BootstrapSnapshot = { status: 'idle', bootstrap: null };

let snapshot: BootstrapSnapshot = IDLE;
let inflight: AbortController | null = null;
/** The bar's state from the last visit (services/dashboards/barCache.ts): read once, forgotten when the store is reset. */
let seed: Bootstrap | null | undefined;
const listeners = new Set<() => void>();

function publish(next: BootstrapSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function getBootstrapSnapshot(): BootstrapSnapshot {
  return snapshot;
}

export function subscribeBootstrap(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Asks once; later callers share the answer (a failed one too, so the page never retries by itself). */
export function ensureBootstrap(): void {
  if (snapshot.status !== 'idle') return;
  const controller = new AbortController();
  inflight = controller;
  publish({ status: 'loading', bootstrap: null });
  void fetchBootstrap(controller.signal).then((bootstrap) => {
    if (inflight !== controller) return;
    inflight = null;
    // A live answer is the new last good state; "disabled" clears it; a failure keeps what there was.
    if (bootstrap?.enabled) writeBarCache(bootstrap);
    else if (bootstrap) clearBarCache();
    seed = undefined;
    publish({ status: 'ready', bootstrap });
  });
}

/** Asks again after a failed answer (the retry button): the page shows its loading state meanwhile. */
export function retryBootstrap(): void {
  resetBootstrap();
  ensureBootstrap();
}

/** Sets the answer without asking (tests and the test setup: `null` is a failed answer, an `enabled: false` bootstrap is the demo). */
export function primeBootstrap(bootstrap: Bootstrap | null): void {
  inflight?.abort();
  inflight = null;
  seed = undefined;
  publish({ status: 'ready', bootstrap });
}

/** Forgets the answer: the next dashboards page asks again. */
export function resetBootstrap(): void {
  inflight?.abort();
  inflight = null;
  seed = undefined;
  publish(IDLE);
}

/** The bar's state from the last visit, for the paint before the answer is in (null when there is none). */
export function getBarSeed(): Bootstrap | null {
  if (seed === undefined) seed = readBarCache();
  return seed;
}

/** The projects changed (a create, a rename, an icon, an archive): the bar's cache follows, so the next load paints them. */
export function updateBarCacheProjects(projects: readonly LiveProjectRef[]): void {
  if (snapshot.status === 'ready' && snapshot.bootstrap?.enabled) writeBarCache(snapshot.bootstrap, projects);
}
