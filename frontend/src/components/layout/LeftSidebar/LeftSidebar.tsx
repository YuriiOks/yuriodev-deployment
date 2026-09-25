import React from 'react';
import styles from './LeftSidebar.module.css';
import { useSectionNav } from '../../../context/useSectionNav';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { minWidth } from '../../../constants/breakpoints';
import SectionLink from '../SectionLink/SectionLink';

/**
 * Section navigation in the left gutter, from the sidebar breakpoint (88rem)
 * up; below it the header's menu lists the same sections instead, so exactly
 * one of the two is ever on screen. From another page its links open the
 * home page at that section.
 */
const LeftSidebar: React.FC = () => {
  const wide = useMediaQuery(minWidth('sidebar'));
  const { sections, activeId } = useSectionNav();

  if (!wide) return null;

  return (
    <nav className={styles.leftSidebarNav} id="leftSidebarNav" aria-label="Section navigation">
      {sections.map(({ id, label }) => (
        <SectionLink
          key={id}
          id={id}
          current={activeId === id}
          className={`${styles.sidebarNavLink} ${activeId === id ? styles.active : ''}`}
          aria-label={`Go to ${label.toLowerCase()} section`}
        >
          <span className={styles.diamond}></span>
          <span className={styles.linkText}>{label}</span>
        </SectionLink>
      ))}
    </nav>
  );
};

export default LeftSidebar;
