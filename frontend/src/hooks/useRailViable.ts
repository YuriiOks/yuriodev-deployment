import { useMediaQuery } from './useMediaQuery';
import { minHeight, minWidth, RAIL_MIN_HEIGHT_REM } from '../constants/breakpoints';

/**
 * Whether the section rail has room to be the page's navigation surface
 * right now: wide enough (the sidebar breakpoint) AND tall enough
 * (RAIL_MIN_HEIGHT_REM) not to cover the fixed header or run off the
 * bottom of the window. Two separate media queries, combined here (not one
 * compound `(min-width: ...) and (min-height: ...)` query), so each stays
 * independently readable in a test double that mocks matchMedia by query
 * string. Header.tsx (whether to show its own menu instead) and
 * SectionRail.tsx (whether to render at all) both call this, so exactly
 * one navigation surface is ever on screen (geometry.spec.ts's "navigation
 * surfaces" tests, navSurfaces.test.tsx).
 */
export function useRailViable(): boolean {
  const wide = useMediaQuery(minWidth('sidebar'));
  const tall = useMediaQuery(minHeight(RAIL_MIN_HEIGHT_REM));
  return wide && tall;
}
