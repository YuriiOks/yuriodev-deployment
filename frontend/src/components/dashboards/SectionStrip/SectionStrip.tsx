import React from 'react';
import styles from './SectionStrip.module.css';

export interface SectionStripProps {
  /** Makes the heading's id unique on the page. */
  id: string;
  title: string;
  /** How many cards the section holds (a small count pill beside the title). */
  count?: number;
  /** An action at the right end (the Projects strip's "New project"). */
  action?: React.ReactNode;
}

/**
 * A section's header: a slim glass strip in the same family as the hub's top strip (the glass, the radius, the page's border,
 * the '# ' title in the heading colour), with the count and, when the section has one, its action at the right. Every row of
 * cards on the hub has one, so the rows read as sections of the same page.
 */
const SectionStrip: React.FC<SectionStripProps> = ({ id, title, count, action }) => (
  <div className={styles.strip}>
    <h2 id={id} className={styles.title}>
      {title}
    </h2>
    {count !== undefined && <span className={styles.count}>{count}</span>}
    {action && <div className={styles.action}>{action}</div>}
  </div>
);

export default SectionStrip;
