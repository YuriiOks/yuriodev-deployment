import { useCallback, useSyncExternalStore } from 'react';
import { useDashboardLang } from '../context/useDashboardLang';
import { getBootstrapSnapshot, subscribeBootstrap } from '../services/dashboards/bootstrapStore';
import { SPACE_NAME } from '../services/dashboards/spaces';
import type { SpaceId } from '../services/dashboards/types';

export interface SpaceNames {
  /** What to show for a space: the server's name (same in both languages), else the bundled bilingual one. */
  readonly nameOf: (space: SpaceId) => string;
  /** The server's name for a space, or undefined when the page runs on the sample data or the space is not renamed. */
  readonly serverNameOf: (space: SpaceId) => string | undefined;
}

const NONE: Readonly<Partial<Record<SpaceId, string>>> = {};

/**
 * Space names for the live dashboards. `GET /bootstrap` can rename a space (the real names live in the server's
 * untracked config, never in this repo); everything that shows a space's name reads it through here.
 */
export function useSpaceNames(): SpaceNames {
  const { text } = useDashboardLang();
  const snapshot = useSyncExternalStore(subscribeBootstrap, getBootstrapSnapshot, getBootstrapSnapshot);
  const names = snapshot.bootstrap?.enabled ? snapshot.bootstrap.spaceNames : NONE;
  const serverNameOf = useCallback((space: SpaceId) => names[space], [names]);
  const nameOf = useCallback((space: SpaceId) => names[space] ?? text(SPACE_NAME[space]), [names, text]);
  return { nameOf, serverNameOf };
}
