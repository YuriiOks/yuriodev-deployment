import { isSectionId, type SectionId } from '../data/site';

/**
 * Which of the home page's sections are on the page, and which one is in
 * view, outside React (read through useSyncExternalStore).
 *
 * One IntersectionObserver watches the sections; one MutationObserver on
 * <main> (direct children only, where the sections live) notices a route
 * change swapping them, so removed sections are unobserved at once and newly
 * mounted ones observed, never a stale node.
 */
export interface SectionTracker {
  /** Starts watching `main`; returns the function that stops. */
  connect(main: HTMLElement, notify: () => void): () => void;
  /** "<active id>|<present ids, comma-separated, DOM order>": a string, so equal states compare equal. */
  snapshot(): string;
}

/** A section counts as in view while it crosses the middle line of the viewport. */
export const ACTIVE_LINE_MARGIN = '-50% 0px -50% 0px';

export function createSectionTracker(): SectionTracker {
  let active: SectionId | null = null;
  let present: SectionId[] = [];
  let current = '|';

  const refresh = () => {
    current = `${active ?? ''}|${present.join(',')}`;
  };

  return {
    snapshot: () => current,

    connect(main, notify) {
      let observed: Element[] = [];

      const intersection = new IntersectionObserver(
        (entries) => {
          let changed = false;
          for (const entry of entries) {
            const { id } = entry.target;
            if (entry.isIntersecting && isSectionId(id) && id !== active) {
              active = id;
              changed = true;
            }
          }
          if (changed) {
            refresh();
            notify();
          }
        },
        { rootMargin: ACTIVE_LINE_MARGIN },
      );

      const scan = () => {
        const sections = Array.from(main.children).filter(
          (element) => element.tagName === 'SECTION' && isSectionId(element.id),
        );
        for (const element of observed) if (!sections.includes(element)) intersection.unobserve(element);
        for (const element of sections) if (!observed.includes(element)) intersection.observe(element);
        observed = sections;

        const ids = sections.map((element) => element.id as SectionId);
        if (ids.join(',') === present.join(',')) return;
        present = ids;
        if (active !== null && !ids.includes(active)) active = null;
        refresh();
        notify();
      };

      scan();
      const mutations = new MutationObserver(scan);
      mutations.observe(main, { childList: true });

      return () => {
        mutations.disconnect();
        intersection.disconnect();
        observed = [];
      };
    },
  };
}

/** Splits a snapshot back into its parts. */
export function parseSnapshot(snapshot: string): { active: SectionId | null; present: SectionId[] } {
  const [activePart, presentPart] = snapshot.split('|');
  return {
    active: activePart && isSectionId(activePart) ? activePart : null,
    present: presentPart ? presentPart.split(',').filter(isSectionId) : [],
  };
}
