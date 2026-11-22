import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { SPACES, SPACE_NAME } from '../../../services/dashboards/spaces';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import styles from './CalendarToolbar.module.css';

export type CalendarView = 'week' | 'month';

export interface CalendarToolbarProps {
  /** Overlapping events of different spaces in what is on screen. */
  conflicts: number;
  view: CalendarView;
  onView: (view: CalendarView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

/**
 * The calendar's controls: the legend (one colour per space), the count of
 * conflicts, previous / today / next (a week or a month, by the view) and the
 * Week / Month switch.
 */
const CalendarToolbar: React.FC<CalendarToolbarProps> = ({ conflicts, view, onView, onPrev, onNext, onToday }) => {
  const { t, text } = useDashboardLang();
  const week = view === 'week';
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
      <div role="group" aria-label={t.periodLabel} className={styles.steps}>
        <button type="button" className={cx(styles.step, styles.square)} aria-label={week ? t.prevWeek : t.prevMonth} onClick={onPrev}>
          <DashIcon name="prev" size={18} strokeWidth={2.2} />
        </button>
        <button type="button" className={styles.step} onClick={onToday}>
          {t.today}
        </button>
        <button type="button" className={cx(styles.step, styles.square)} aria-label={week ? t.nextWeek : t.nextMonth} onClick={onNext}>
          <DashIcon name="next" size={18} strokeWidth={2.2} />
        </button>
      </div>
      <div role="group" aria-label={t.viewLabel} className={styles.view}>
        <button
          type="button"
          aria-pressed={week}
          className={cx(styles.option, week && styles.on)}
          onClick={() => onView('week')}
        >
          {t.week}
        </button>
        <button
          type="button"
          aria-pressed={!week}
          className={cx(styles.option, !week && styles.on)}
          onClick={() => onView('month')}
        >
          {t.month}
        </button>
      </div>
    </div>
  );
};

export default CalendarToolbar;
