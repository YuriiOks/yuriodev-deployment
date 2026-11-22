import React from 'react';
import styles from './DashboardHeading.module.css';

export interface DashboardHeadingProps {
  id: string;
  title: string;
  /** A smaller text on the title's line (the calendar's date range). */
  aside?: string;
  lead: string;
  /** Controls at the right of the title (the calendar's legend and view switch). */
  children?: React.ReactNode;
}

/** A dashboard page's title block: the '# title' (the page's h1), a lead line and optional controls. */
const DashboardHeading: React.FC<DashboardHeadingProps> = ({ id, title, aside, lead, children }) => (
  <div className={styles.heading}>
    <div className={styles.text}>
      <h1 id={id} className={styles.title}>
        {title}
        {aside && <span className={styles.aside}> {aside}</span>}
      </h1>
      <p className={styles.lead}>{lead}</p>
    </div>
    {children}
  </div>
);

export default DashboardHeading;
