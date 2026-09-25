import { scrollBehavior } from './motion';

/**
 * Scrolls the element with this id to the top of the view (html's
 * scroll-padding-top keeps it clear of the fixed header); instantly under
 * reduced motion. False when there is no such element.
 */
export function scrollToId(id: string): boolean {
  const element = document.getElementById(id);
  if (!element) return false;
  element.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  return true;
}
