import { useCallback, useSyncExternalStore } from 'react';
import { useDashboardLang } from '../context/useDashboardLang';
import siteMark from '../assets/site-mark.svg';
import { getBarSeed, getBootstrapSnapshot, subscribeBootstrap } from '../services/dashboards/bootstrapStore';
import { SPACE_NAME } from '../services/dashboards/spaces';
import type { SpaceId } from '../services/dashboards/types';

export interface SpaceNames {
  /** What to show for a space: the server's name (same in both languages), else the bundled bilingual one. */
  readonly nameOf: (space: SpaceId) => string;
  /** The server's name for a space, or undefined when the page runs on the sample data or the space is not renamed. */
  readonly serverNameOf: (space: SpaceId) => string | undefined;
  /**
   * The image for a space's tile on the live dashboards, or undefined for the letter or number tile: the icon
   * the server gave (an image data URI, never a link), else, for the personal space, the site's own mark.
   */
  readonly iconOf: (space: SpaceId) => string | undefined;
}

const NONE: Readonly<Partial<Record<SpaceId, string>>> = {};

/**
 * Space names and icons for the live dashboards. `GET /bootstrap` can rename a space and give it an icon (the real
 * ones live in the server's untracked config, never in this repo); everything that shows a space's name or tile
 * reads it through here. The sample data keeps the bundled names and the letter tiles.
 */
export function useSpaceNames(): SpaceNames {
  const { text } = useDashboardLang();
  const snapshot = useSyncExternalStore(subscribeBootstrap, getBootstrapSnapshot, getBootstrapSnapshot);
  // Until the answer is in, the last visit's names and icons (if any) are used, so the first paint is already the final one.
  const bootstrap =
    snapshot.status === 'ready' ? (snapshot.bootstrap === null ? getBarSeed() : snapshot.bootstrap.enabled ? snapshot.bootstrap : null) : getBarSeed();
  const live = bootstrap !== null;
  const names = bootstrap?.spaceNames ?? NONE;
  const icons = bootstrap?.spaceIcons ?? NONE;
  const serverNameOf = useCallback((space: SpaceId) => names[space], [names]);
  const nameOf = useCallback((space: SpaceId) => names[space] ?? text(SPACE_NAME[space]), [names, text]);
  const iconOf = useCallback(
    (space: SpaceId) => (live ? (icons[space] ?? (space === 'personal' ? siteMark : undefined)) : undefined),
    [live, icons],
  );
  return { nameOf, serverNameOf, iconOf };
}
