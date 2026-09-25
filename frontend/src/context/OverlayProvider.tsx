import React, { useCallback, useMemo, useState } from 'react';
import { OverlayContext, type OverlayId, type OverlayState } from './overlay-context';

interface OverlayProviderProps {
  children: React.ReactNode;
}

/**
 * At most one of the command palette, the help panel and the header menu is
 * open at a time: state holds a single id, so opening one replaces the other
 * by construction.
 */
export const OverlayProvider: React.FC<OverlayProviderProps> = ({ children }) => {
  const [active, setActive] = useState<OverlayId | null>(null);

  const open = useCallback((id: OverlayId) => setActive(id), []);
  const close = useCallback((id: OverlayId) => setActive((current) => (current === id ? null : current)), []);
  const toggle = useCallback((id: OverlayId) => setActive((current) => (current === id ? null : id)), []);

  const value = useMemo<OverlayState>(() => ({ active, open, close, toggle }), [active, open, close, toggle]);
  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
};
