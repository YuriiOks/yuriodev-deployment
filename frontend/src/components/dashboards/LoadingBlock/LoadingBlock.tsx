import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import styles from './LoadingBlock.module.css';

export interface LoadingBlockProps {
  /** How many placeholder rows (40px each), so the block is about as tall as what replaces it. */
  rows?: number;
}

/** A calm placeholder in the shape of a panel of rows: no motion, no layout jump when the rows arrive. */
const LoadingBlock: React.FC<LoadingBlockProps> = ({ rows = 3 }) => {
  const { t } = useDashboardLang();
  return (
    <div className={styles.block} role="status" aria-busy="true">
      <span className="sr-only">{t.loading}</span>
      <span aria-hidden="true" className={styles.head} />
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} aria-hidden="true" className={styles.row} />
      ))}
    </div>
  );
};

export default LoadingBlock;
