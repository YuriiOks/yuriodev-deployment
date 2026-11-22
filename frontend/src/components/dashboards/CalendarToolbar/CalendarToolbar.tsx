import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { SPACES, SPACE_NAME } from '../../../services/dashboards/spaces';
import DashIcon from '../DashIcon/DashIcon';
import styles from './CalendarToolbar.module.css';

export interface CalendarToolbarProps {
  /** Overlapping events of different spaces this week. */
  conflicts: number;
}

/** The calendar's legend (one colour per space), the count of conflicts and the Week / Month switch. Month is not built yet, so it is off. */
const CalendarToolbar: React.FC<CalendarToolbarProps> = ({ conflicts }) => {
  const { t, text } = useDashboardLang();
  return (
    <div className={styles.toolbar}>
      <ul className={styles.legend}>
        {SPACES.map((space) => (
          <li key={space} className={styles.item}>
            <span aria-hidden="true" className={styles.swatch} data-for={space} />
            {text(SPACE_NAME[space])}
          </li>
        ))}
      </ul>
      <p className={styles.conflicts} data-conflicts={conflicts > 0 ? 'some' : 'none'}>
        {conflicts > 0 && <DashIcon name="alert" size={14} strokeWidth={2.2} />}
        <span>{conflicts > 0 ? `${t.conflicts}: ${conflicts}` : t.noConflicts}</span>
      </p>
      <div role="group" aria-label={t.viewLabel} className={styles.view}>
        <button type="button" aria-pressed="true" className={`${styles.option} ${styles.on}`}>
          {t.week}
        </button>
        <button type="button" aria-pressed="false" disabled title={t.monthSoon} className={styles.option}>
          {t.month}
        </button>
      </div>
    </div>
  );
};

export default CalendarToolbar;
