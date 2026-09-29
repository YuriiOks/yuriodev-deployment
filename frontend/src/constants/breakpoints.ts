/**
 * The site's seven layout breakpoints, in rem (documented in _variables.css).
 * CSS cannot read custom properties inside @media, so stylesheets repeat the
 * literal rem values; breakpoints.test.ts fails on any other width.
 */
export const BREAKPOINTS = {
  /** 480px: phone to large phone. */
  sm: 30,
  /** 768px: tablet; the header grows to 64px. */
  md: 48,
  /** 1024px: small laptop; the header's help button appears. */
  lg: 64,
  /** 1280px: desktop; the footer lays out in one row. */
  xl: 80,
  /** 1408px: the section rail replaces the header's menu, width permitting (see useRailViable). */
  sidebar: 88,
  /** 1440px: was the reference screen where the root font started to grow with it; the root no longer scales. */
  fluid: 90,
  /** 1600px: the rail shows its labels at rest. */
  wide: 100,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/** Media query that matches from `bp` up, e.g. '(min-width: 88rem)'. */
export const minWidth = (bp: Breakpoint): string => `(min-width: ${BREAKPOINTS[bp]}rem)`;

/**
 * The shortest window the section rail can show in without covering the
 * fixed header or running off the bottom of the window.
 *
 * The rail is centred with `top: 50%` + `translateY(-50%)`, so its top
 * edge sits at `viewportHeight / 2 - railHeight / 2`. Clearing the fixed
 * header (height `H`) needs that top edge at or below the header's own
 * bottom edge (`H`, since the header is pinned at the very top):
 *   viewportHeight / 2 - railHeight / 2 >= H
 *   viewportHeight            >= railHeight + 2 * H
 * Centring costs *two* header-heights of clearance, not one - an earlier
 * version of this constant budgeted only one and let the rail sit under
 * the header at some heights just past its own threshold (confirmed live:
 * with the worst-case rail - touch-target row height, all 8 sections - a
 * width>=1408px, hasTouch window overlapped the header at every height
 * from the old 29rem threshold up to 506px, clearing only from 508px on).
 *
 * Worst case: `H` = 4rem (the header from the md breakpoint up, always
 * true here) and `railHeight` = 8 rows (every section, including the
 * optional Posts one) at the touch-target row size (2.75rem each, `pointer:
 * coarse` - taller than a mouse pointer's 1.75rem), plus the rail's own
 * 1.5rem of padding and ~0.125rem of border: 8*2.75 + 1.5 + 0.125 =
 * 23.625rem. So viewportHeight >= 23.625 + 2*4 = 31.625rem (506px);
 * rounded up to a clean number with a little headroom. A height query, not
 * a width one - breakpoints.test.ts's scale is widths only. */
export const RAIL_MIN_HEIGHT_REM = 32;

/** Media query that matches from `rem` tall up, e.g. '(min-height: 29rem)'. */
export const minHeight = (rem: number): string => `(min-height: ${rem}rem)`;
