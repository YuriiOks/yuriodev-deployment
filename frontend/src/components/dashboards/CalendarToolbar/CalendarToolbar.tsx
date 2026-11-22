import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { SPACES, SPACE_NAME } from '../../../services/dashboards/spaces';
import styles from './CalendarToolbar.module.css';

/** The calendar's legend (one colour per space) and its Week / Month switch. Month is not built yet, so it is off. */
const CalendarToolbar: React.FC = () => {
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
