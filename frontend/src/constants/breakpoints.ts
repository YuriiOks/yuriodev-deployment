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
 * fixed header or running off the bottom of the window: the header's own
 * height (4rem, from the md breakpoint up, always true here) plus the
 * rail's own worst-case height (8 rows - every section, including the
 * optional Posts one - at the touch-target row size, 2.75rem each, plus
 * its own 1.5rem of padding), with a little headroom. A height query, not
 * a width one - breakpoints.test.ts's scale is widths only. */
export const RAIL_MIN_HEIGHT_REM = 29;

/** Media query that matches from `rem` tall up, e.g. '(min-height: 29rem)'. */
export const minHeight = (rem: number): string => `(min-height: ${rem}rem)`;
