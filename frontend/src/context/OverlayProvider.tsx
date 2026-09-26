import React, { useCallback, useMemo, useState } from 'react';
import { OverlayContext, type OverlayId, type OverlayState } from './overlay-context';

interface OverlayProviderProps {
  /**
   * The current route. The header's menus belong to the page they were
   * opened on: once this changes, they count as closed.
   */
  routeKey?: string;
  children: React.ReactNode;
}

interface Opened {
  id: OverlayId;
  routeKey: string | undefined;
}

/** The overlays that close when the route changes (the dialogs stay open). */
const ROUTE_BOUND: ReadonlySet<OverlayId> = new Set(['menu', 'more']);

/** What is open, with a menu left over from an earlier route counting as closed. */
function activeOf(opened: Opened | null, routeKey: string | undefined): OverlayId | null {
  if (!opened) return null;
  return ROUTE_BOUND.has(opened.id) && opened.routeKey !== routeKey ? null : opened.id;
}

/**
 * At most one of the command palette, the help panel, the header menu and
 * the More menu is open at a time: state holds a single id, so opening one replaces the other
 * by construction.
 */
export const OverlayProvider: React.FC<OverlayProviderProps> = ({ routeKey, children }) => {
  const [opened, setOpened] = useState<Opened | null>(null);
  const active = activeOf(opened, routeKey);

  const open = useCallback((id: OverlayId) => setOpened({ id, routeKey }), [routeKey]);
  const close = useCallback(
    (id: OverlayId) => setOpened((current) => (current?.id === id ? null : current)),
    [],
  );
  const toggle = useCallback(
    (id: OverlayId) =>
      setOpened((current) => (activeOf(current, routeKey) === id ? null : { id, routeKey })),
    [routeKey],
  );

  const value = useMemo<OverlayState>(() => ({ active, open, close, toggle }), [active, open, close, toggle]);
  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
};
