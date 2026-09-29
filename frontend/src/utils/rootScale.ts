/**
 * The root font size relative to 16px. The site never sets a size on html
 * (so browser zoom keeps working), which makes this 1 unless the visitor has
 * changed the browser's default font size. Code that works in real CSS pixels
 * because rem doesn't reach it - the canvas background's node sizes, the
 * section rail's minimum gutter, the scroll-to-top button's reveal threshold -
 * multiplies its own constant by this so it follows that preference too.
 */
export function getRootScale(): number {
  if (typeof document === 'undefined' || !document.documentElement) return 1;
  const pixels = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(pixels) && pixels > 0 ? pixels / 16 : 1;
}
