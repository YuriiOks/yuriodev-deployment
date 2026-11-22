import React, { useRef } from 'react';
import styles from './SectionRail.module.css';
import { useSectionNav } from '../../../context/useSectionNav';
import { useRailViable } from '../../../hooks/useRailViable';
import { useGutterCenter } from '../../../hooks/useGutterCenter';
import { cx } from '../../../utils/cx';
import SectionLink from '../SectionLink/SectionLink';

/**
 * Section navigation pinned in the left gutter, from the sidebar breakpoint
 * (88rem) up and tall enough to clear the fixed header and the bottom of
 * the window (useRailViable); below either threshold the header's menu
 * lists the same sections instead, so exactly one of the two is ever on
 * screen.
 *
 * Visible from the very first paint, hero included, on a light glass
 * backing: a thin track with one diamond tick and label per section, the
 * track filling with the accent down to the section in view. Centred
 * between the window edge and the content column (never closer than 16px
 * to the edge, nor closer than 24px to the column even under a bad
 * transient measurement - useGutterCenter) and, at every height it shows
 * at, vertically on the viewport (CSS `top: 50%`; useRailViable's own
 * height threshold keeps that centred position clear of the header and the
 * bottom without needing a JS override). From another page its links open
 * the home page at that section.
 */
const SectionRail: React.FC = () => {
  const viable = useRailViable();
  const { sections, activeId } = useSectionNav();
  const railRef = useRef<HTMLElement>(null);
  const { probeRef, left } = useGutterCenter(railRef, viable);

  if (!viable) return null;

  const activeIndex = sections.findIndex(({ id }) => id === activeId);
  // How far down the track the fill reaches: 0 at the first tick, 1 at the last.
  const progress = activeIndex <= 0 || sections.length < 2 ? 0 : activeIndex / (sections.length - 1);

  return (
    <>
      {/* Sized to the content column's own formula (--content-max-width),
          never shown: only its rendered width is read (useGutterCenter),
          so that formula never has to be repeated in JavaScript. */}
      <div ref={probeRef} className={styles.probe} aria-hidden="true" />
      <nav
        ref={railRef}
        className={styles.rail}
        id="sectionRail"
        aria-label="Section navigation"
        style={{ '--rail-progress': progress, left: `${left}px` } as React.CSSProperties}
      >
        <span className={styles.track} aria-hidden="true">
          <span className={styles.fill} />
        </span>
        <ul className={styles.list}>
          {sections.map(({ id, label }) => {
            const current = activeId === id;
            return (
              <li key={id}>
                <SectionLink
                  id={id}
                  current={current}
                  className={cx(styles.link, current && styles.current)}
                  aria-label={`Go to ${label.toLowerCase()} section`}
                >
                  <span className={styles.tick} aria-hidden="true" />
                  <span className={styles.label}>{label}</span>
                </SectionLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
};

export default SectionRail;
