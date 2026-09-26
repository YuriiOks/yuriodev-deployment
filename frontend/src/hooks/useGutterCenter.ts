import { useEffect, useRef, useState, type RefObject } from 'react';

export interface GutterCenter {
  /** Attach to a hidden probe sized `width: var(--content-max-width)`. */
  probeRef: RefObject<HTMLDivElement | null>;
  /** Left offset (px) that centres the measured element in the gutter. */
  left: number;
}

/**
 * Left offset that centres `railRef`'s element in the page's left gutter -
 * the space between the window edge and the content column
 * (--content-max-width, _variables.css) - never closer than 16px to the
 * window edge.
 *
 * A hidden probe the caller sizes to that same custom property is measured
 * instead of the formula being repeated here: a ResizeObserver on it and on
 * the rail element itself keeps `left` current across window resizes, the
 * root font size growing above 100rem, and the rail's own width changing
 * with its labels.
 */
export function useGutterCenter(railRef: RefObject<HTMLElement | null>): GutterCenter {
  const probeRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(16);

  useEffect(() => {
    const probe = probeRef.current;
    const rail = railRef.current;
    if (!probe || !rail || typeof ResizeObserver === 'undefined') return undefined;

    const update = () => {
      const gutter = (window.innerWidth - probe.getBoundingClientRect().width) / 2;
      const railWidth = rail.getBoundingClientRect().width;
      setLeft(Math.max(16, (gutter - railWidth) / 2));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(probe);
    observer.observe(rail);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [railRef]);

  return { probeRef, left };
}
