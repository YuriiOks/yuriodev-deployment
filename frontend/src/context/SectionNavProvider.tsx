import React, { useCallback, useMemo, useState, useSyncExternalStore, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SECTIONS, pagePath, type AnchorId } from '../data/site';
import { scrollToId } from '../utils/scroll';
import { SectionNavContext, type SectionNav } from './section-nav-context';
import { createSectionTracker, parseSnapshot } from './sectionTracker';

interface SectionNavProviderProps {
  /** The <main> element whose direct children are the sections. */
  mainRef: RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

const emptySnapshot = () => '|';

/**
 * The one source of section navigation state, shared by the header menu, the
 * sidebar, the command palette and the J/K shortcuts.
 */
export const SectionNavProvider: React.FC<SectionNavProviderProps> = ({ mainRef, children }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [tracker] = useState(createSectionTracker);

  const subscribe = useCallback(
    (notify: () => void) => {
      const main = mainRef.current;
      return main ? tracker.connect(main, notify) : () => {};
    },
    [tracker, mainRef],
  );
  const snapshot = useSyncExternalStore(subscribe, tracker.snapshot, emptySnapshot);

  const onHome = pathname === pagePath('portfolio');

  // Stable while the page stays the same, so consumers that list commands
  // or bind keys do not rebuild on every scroll.
  const goTo = useCallback(
    (id: AnchorId) => {
      if (onHome) scrollToId(id);
      else navigate(`${pagePath('portfolio')}#${id}`);
    },
    [onHome, navigate],
  );

  const value = useMemo<SectionNav>(() => {
    const parsed = parseSnapshot(snapshot);
    const present = onHome ? parsed.present : [];
    const activeId = onHome ? parsed.active : null;
    const sections = SECTIONS.filter((section) => !section.optional || present.includes(section.id));

    const step = (direction: 1 | -1) => {
      if (present.length === 0) return;
      const index = activeId === null ? -1 : present.indexOf(activeId);
      const target = index === -1 ? 0 : Math.min(Math.max(index + direction, 0), present.length - 1);
      scrollToId(present[target]);
    };

    return { sections, present, activeId, onHome, goTo, step };
  }, [snapshot, onHome, goTo]);

  return <SectionNavContext.Provider value={value}>{children}</SectionNavContext.Provider>;
};
