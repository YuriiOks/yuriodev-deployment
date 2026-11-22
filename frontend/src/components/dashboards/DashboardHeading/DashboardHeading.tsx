import React from 'react';
import styles from './DashboardHeading.module.css';

export interface DashboardHeadingProps {
  id: string;
  title: string;
  /** Controls at the right of the title. */
  children?: React.ReactNode;
}

/** A dashboard page's title: the page's h1 (20px 600, one line per page), with optional controls at its right. */
const DashboardHeading: React.FC<DashboardHeadingProps> = ({ id, title, children }) => (
  <div className={styles.heading}>
    <h1 id={id} className={styles.title}>
      {title}
    </h1>
    {children}
  </div>
);

export default DashboardHeading;
