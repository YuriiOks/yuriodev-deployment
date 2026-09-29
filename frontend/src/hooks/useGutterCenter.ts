import { useEffect, useRef, useState, type RefObject } from 'react';
import { getRootScale } from '../utils/rootScale';

export interface GutterCenter {
  /** Attach to a hidden probe sized `width: var(--content-max-width)`. */
  probeRef: RefObject<HTMLDivElement | null>;
  /** Left offset (px) that centres the measured element in the gutter. */
  left: number;
}

/**
 * Left offset that centres `railRef`'s element in the page's left gutter -
 * the space between the window edge and the content column
 * (--content-max-width, _variables.css) - never closer than 1rem to the
 * window edge, and never closer than 1.5rem to the content column even if a
 * single measurement briefly comes back wrong (in real pixels: 16px/24px
 * unless a browser or OS accessibility setting grows the root font size -
 * getRootScale). That second floor is defence in depth, not the everyday
 * path: the gutter formula below already keeps well past it in ordinary
 * use (e2e/geometry.spec.ts checks the real margin at every width and
 * route the rail shows at).
 *
 * A hidden probe the caller sizes to that same custom property is measured
 * instead of the formula being repeated here: a ResizeObserver on it and on
 * the rail element itself keeps `left` current across window resizes and
 * the rail's own width changing with its labels.
 *
 * `mounted` must reflect whether the caller is actually rendering the
 * `<nav>`/probe right now (SectionRail passes its own `useRailViable()`
 * result). The nodes only exist once that is true, and a `useRef`'s
 * identity never changes across renders - without `mounted` in the effect's
 * own dependencies, a first render where it was false (both refs still
 * null) would attach nothing, ever, even once it later becomes true and the
 * nodes actually mount (a stale-effect bug: `left` stuck at its default
 * forever, confirmed live - useGutterCenter.test.tsx, e2e/geometry.spec.ts's
 * "section rail resize" test).
 */
export function useGutterCenter(railRef: RefObject<HTMLElement | null>, mounted: boolean): GutterCenter {
  const probeRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(16);

  useEffect(() => {
    const probe = probeRef.current;
    const rail = railRef.current;
    if (!mounted || !probe || !rail || typeof ResizeObserver === 'undefined') return undefined;

    const update = () => {
      const scale = getRootScale();
      const minGutter = 16 * scale;
      // The content column's own left edge: rail.right must stay at least
      // this much margin before it, whatever a single measurement says.
      const margin = 24 * scale;
      const gutter = (window.innerWidth - probe.getBoundingClientRect().width) / 2;
      const railWidth = rail.getBoundingClientRect().width;
      const centred = Math.max(minGutter, (gutter - railWidth) / 2);
      const safeMax = Math.max(minGutter, gutter - railWidth - margin);
      setLeft(Math.min(centred, safeMax));
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
  }, [railRef, mounted]);

  return { probeRef, left };
}
