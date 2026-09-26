import { createContext } from 'react';
import type { AnchorId, SectionDef, SectionId } from '../data/site';

export interface SectionNav {
  /** Sections the navigation lists, in DOM order (an optional one only while it is on the page). */
  sections: readonly SectionDef[];
  /** Sections mounted in <main> right now, in DOM order: empty off the home page. */
  present: readonly SectionId[];
  /** The section crossing the middle of the viewport; null off the home page. */
  activeId: SectionId | null;
  /** True on the home page, where the sections live. */
  onHome: boolean;
  /** Scrolls to a section or the terminal; from another page, opens the home page there. */
  goTo: (id: AnchorId) => void;
  /** Scrolls to the next (1) or previous (-1) section on the page. */
  step: (direction: 1 | -1) => void;
}

export const SectionNavContext = createContext<SectionNav | undefined>(undefined);
