/**
 * How far the root font size has grown past its 16px baseline: 1 below the
 * "fluid" breakpoint (90rem, 1440px - global.css) and above it the same
 * factor global.css itself uses to grow every rem on the page. Code that
 * still works in real CSS pixels because rem doesn't reach it - the canvas
 * background's node sizes, the section rail's minimum gutter, the
 * scroll-to-top button's reveal threshold - reads this once and multiplies
 * its own constant by it, so it grows in step with everything else instead
 * of looking small on a big screen.
 */
export function getRootScale(): number {
  if (typeof document === 'undefined' || !document.documentElement) return 1;
  const pixels = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(pixels) && pixels > 0 ? pixels / 16 : 1;
}
