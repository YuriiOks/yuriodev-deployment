import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { weekdayIndex } from '../../../services/dashboards/calendarDates';
import { dateLabel, fill } from '../../../services/dashboards/calendarLabels';
import { localDate } from '../../../services/dashboards/liveTime';
import type { Localized } from '../../../services/dashboards/types';
import styles from './HubHeader.module.css';

export interface HubHeaderProps {
  title: string;
  /** Open tasks across the three spaces; null while it is not known (the line is then left out). */
  totalOpen: number | null;
  /** The nearest next event of any space, or null when there is none (or it is not known). */
  next: { date?: string; at: string; title: Localized } | null;
  now: Date;
}

/**
 * The hub's header, a card of its own in the site's palette (the personal cyan washing into amber): the page's h1,
 * today's date, one line of totals (open tasks across the spaces) and the nearest next event. It uses only what the
 * hub already has; it asks for nothing.
 */
const HubHeader: React.FC<HubHeaderProps> = ({ title, totalOpen, next, now }) => {
  const { t, text } = useDashboardLang();
  const today = localDate(now);
  return (
    <div className={styles.header} data-scheme="site">
      <div className={styles.titles}>
        <h1 id="dashboards-title" className={styles.title}>
          {title}
        </h1>
        <p className={styles.date}>
          {t.weekdaysShort[weekdayIndex(today)]}, {dateLabel(today, t)}
        </p>
      </div>
      <div className={styles.totals}>
        {totalOpen !== null && <p className={styles.total}>{fill(t.hubTotalOpen, { n: totalOpen })}</p>}
        {next && (
          <p className={styles.next}>
            <span className={styles.nextLabel}>{t.next}:</span> {next.date && `${next.date} `}
            <span className={styles.at}>{next.at}</span> {text(next.title)}
          </p>
        )}
      </div>
    </div>
  );
};

export default HubHeader;
