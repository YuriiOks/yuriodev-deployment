import { useSyncExternalStore } from 'react';
import { getBootstrapSnapshot, subscribeBootstrap } from '../services/dashboards/bootstrapStore';
import { limitOf, NO_LIMITS } from '../services/dashboards/limits';

/** One limit of the server (`GET /bootstrap` `limits`), or the fallback until the answer is in (or when it does not say). */
export function useLimit(group: string, key: string, fallback: number): number {
  const snapshot = useSyncExternalStore(subscribeBootstrap, getBootstrapSnapshot, getBootstrapSnapshot);
  return limitOf(snapshot.bootstrap?.limits ?? NO_LIMITS, group, key, fallback);
}
