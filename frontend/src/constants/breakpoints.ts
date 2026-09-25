/**
 * The site's five layout breakpoints, in rem (documented in _variables.css).
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
  /** 1408px: the section sidebar replaces the header's menu. */
  sidebar: 88,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/** Media query that matches from `bp` up, e.g. '(min-width: 88rem)'. */
export const minWidth = (bp: Breakpoint): string => `(min-width: ${BREAKPOINTS[bp]}rem)`;
