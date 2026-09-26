import React from 'react';
import styles from './SectionRail.module.css';
import { useSectionNav } from '../../../context/useSectionNav';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { useMostlyInView } from '../../../hooks/useMostlyInView';
import { minWidth } from '../../../constants/breakpoints';
import { cx } from '../../../utils/cx';
import SectionLink from '../SectionLink/SectionLink';

/** The rail stays out of the way while this much of the hero is on screen. */
const HERO_SHARE = 0.4;

/**
 * Section navigation pinned to the left edge of the window, from the sidebar
 * breakpoint (88rem) up; below it the header's menu lists the same sections
 * instead, so exactly one of the two is ever on screen.
 *
 * A thin track with one tick per section. The track fills with the accent
 * down to the section in view. While the hero fills the screen the rail
 * stays hidden (but its links stay focusable: focusing one shows it at once).
 * From another page its links open the home page at that section.
 */
const SectionRail: React.FC = () => {
  const wide = useMediaQuery(minWidth('sidebar'));
  const { sections, activeId, onHome } = useSectionNav();
  // `onHome` is known synchronously from the route, unlike `present` (which
  // depends on the section tracker's own connecting effect) — observing the
  // hero as soon as we know we are on the home page, rather than waiting for
  // it to show up in `present`, keeps the away/shown state correct from the
  // first render (see useMostlyInView's initial-`true` snapshot).
  const heroOnScreen = useMostlyInView(wide && onHome ? 'hero' : null, HERO_SHARE);
  const away = onHome && heroOnScreen;

  if (!wide) return null;

  const activeIndex = sections.findIndex(({ id }) => id === activeId);
  // How far down the track the fill reaches: 0 at the first tick, 1 at the last.
  const progress = activeIndex <= 0 || sections.length < 2 ? 0 : activeIndex / (sections.length - 1);

  return (
    <nav
      className={cx(styles.rail, away && styles.away)}
      id="sectionRail"
      aria-label="Section navigation"
      data-state={away ? 'away' : 'shown'}
      style={{ '--rail-progress': progress } as React.CSSProperties}
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
  );
};

export default SectionRail;
