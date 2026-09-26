import { scrollBehavior } from './motion';

/** The last place a jump was aimed at, and when (Date.now()). */
let lastJump: { readonly id: string; readonly at: number } | null = null;

/**
 * Remembers that the visitor asked to go to `id` (a menu, sidebar or palette
 * jump, or a URL fragment), even when that element is not on the page yet.
 */
export function noteJump(id: string): void {
  lastJump = { id, at: Date.now() };
}

/**
 * The id of the last jump if it was asked for at most `withinMs` ago, else
 * null. Content that appears late uses it to put a jump that it moved back
 * on target.
 */
export function recentJump(withinMs: number): string | null {
  return lastJump && Date.now() - lastJump.at <= withinMs ? lastJump.id : null;
}

/**
 * Scrolls the element with this id to the top of the view (html's
 * scroll-padding-top keeps it clear of the fixed header); instantly under
 * reduced motion. False when there is no such element.
 */
export function scrollToId(id: string): boolean {
  noteJump(id);
  const element = document.getElementById(id);
  if (!element) return false;
  element.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  return true;
}
