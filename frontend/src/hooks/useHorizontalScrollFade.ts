import { useEffect, useState, type RefObject } from 'react';

/**
 * True while `ref`'s element still has more content to the right that a
 * horizontal scroll would reveal - false once it is scrolled all the way,
 * or if its content never overflows. Meant to show and hide a scroll cue
 * (a fade at the trailing edge) on a sideways-scrolling box.
 */
export function useHorizontalScrollFade(ref: RefObject<HTMLElement | null>): boolean {
  const [canScrollMore, setCanScrollMore] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setCanScrollMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [ref]);

  return canScrollMore;
}
