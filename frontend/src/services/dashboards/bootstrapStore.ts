import { fetchBootstrap, type Bootstrap } from './liveApi';

/*
 * Whether the dashboards run on the API or on the bundled sample data, decided once per page load: the first
 * dashboards page asks GET /bootstrap, everything after reads the answer. `enabled: true` is real data; `false`,
 * a network error, a non-2xx answer or a non-JSON body is the sample data, exactly as before the API existed.
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
    publish({ status: 'ready', bootstrap });
  });
}

/** Sets the answer without asking (tests and the test setup: `null` is "no answer", the sample data). */
export function primeBootstrap(bootstrap: Bootstrap | null): void {
  inflight?.abort();
  inflight = null;
  publish({ status: 'ready', bootstrap });
}

/** Forgets the answer: the next dashboards page asks again. */
export function resetBootstrap(): void {
  inflight?.abort();
  inflight = null;
  publish(IDLE);
}
