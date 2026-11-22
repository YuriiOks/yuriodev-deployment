import { useLocation } from 'react-router-dom';
import { useMediaQuery } from './useMediaQuery';
import { minHeight, minWidth, RAIL_MIN_HEIGHT_REM } from '../constants/breakpoints';
import { railAllowedAt } from '../data/site';

/**
 * Whether the section rail is the page's navigation surface right now: the
 * page allows a rail at all (data/site.ts: the dashboards define `rail:
 * false` and use the full width), AND the window is wide enough (the
 * sidebar breakpoint) AND tall enough (RAIL_MIN_HEIGHT_REM) not to cover the
 * fixed header or run off the bottom of the window. The two media queries
 * stay separate (not one compound query), so each is independently
 * readable in a test double that mocks matchMedia by query string.
 * Header.tsx (whether to show its own menu instead) and SectionRail.tsx
 * (whether to render at all) both call this, so exactly one navigation
 * surface is ever on screen (geometry.spec.ts's "navigation surfaces"
 * tests, navSurfaces.test.tsx). Needs a Router: the route decides.
 */
export function useRailViable(): boolean {
  const { pathname } = useLocation();
  const wide = useMediaQuery(minWidth('sidebar'));
  const tall = useMediaQuery(minHeight(RAIL_MIN_HEIGHT_REM));
  return railAllowedAt(pathname) && wide && tall;
}
