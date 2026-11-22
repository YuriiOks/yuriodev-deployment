import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { minHeight, minWidth, RAIL_MIN_HEIGHT_REM } from '../constants/breakpoints';
import { PAGES, railAllowedAt } from '../data/site';
import { useRailViable } from './useRailViable';

let wide = true;
let tall = true;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  wide = true;
  tall = true;
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return (query === minWidth('sidebar') && wide) || (query === minHeight(RAIL_MIN_HEIGHT_REM) && tall);
    },
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

const viableAt = (path: string) =>
  renderHook(() => useRailViable(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    ),
  }).result.current;

describe('railAllowedAt', () => {
  it('every page allows the rail except the dashboards, which define rail: false', () => {
    const without = PAGES.filter((page) => page.rail === false).map(({ path }) => path);
    expect([...without].sort()).toEqual([
      '/dashboards',
      '/dashboards/calendar',
      '/dashboards/personal',
      '/dashboards/work-1',
      '/dashboards/work-2',
    ]);
    for (const path of ['/', '/courses', '/community', '/dashboard', '/privacy', '/no-such-page']) {
      expect(railAllowedAt(path), path).toBe(true);
    }
    for (const path of without) expect(railAllowedAt(path), path).toBe(false);
    // A trailing slash is the same page.
    expect(railAllowedAt('/dashboards/')).toBe(false);
  });
});

describe('useRailViable', () => {
  it('is true on a page with a rail when the window is wide and tall enough', () => {
    expect(viableAt('/')).toBe(true);
    expect(viableAt('/privacy')).toBe(true);
    expect(viableAt('/dashboard')).toBe(true);
  });

  it('is false on every dashboards page, however wide and tall the window', () => {
    for (const path of ['/dashboards', '/dashboards/personal', '/dashboards/work-1', '/dashboards/work-2', '/dashboards/calendar']) {
      expect(viableAt(path), path).toBe(false);
    }
  });

  it('is still false when the window is too narrow or too short, on any page', () => {
    wide = false;
    expect(viableAt('/')).toBe(false);
    wide = true;
    tall = false;
    expect(viableAt('/')).toBe(false);
    expect(viableAt('/privacy')).toBe(false);
  });
});
