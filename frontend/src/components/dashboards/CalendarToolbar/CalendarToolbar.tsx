import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { useSpaceNames } from '../../../hooks/useSpaceNames';
import { SPACES } from '../../../services/dashboards/spaces';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import styles from './CalendarToolbar.module.css';

export type CalendarView = 'week' | 'month';

export interface CalendarToolbarProps {
  /** The range on screen ("23–29 November"): the page's one 20px line, the h1 (with "Calendar" for screen readers). */
  period: string;
  /** Overlapping events of different spaces in what is on screen; shown only above zero. */
  conflicts: number;
  view: CalendarView;
  /** A phone shows one day at a time: the arrows step by a day. */
  day?: boolean;
  onView: (view: CalendarView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  /** Show Monday to Friday only. */
  workdaysOnly: boolean;
  onWorkdaysOnly: (on: boolean) => void;
  /** Real data only: shows a "New event" button that opens the form. */
  onNewEvent?: () => void;
  newEventOpen?: boolean;
}

/**
 * The calendar's one toolbar row: the range (h1), previous / Today / next, then at the right the legend (a dot
 * per space and a hatched swatch for blocks with no details), the conflict count when there is one, the
 * working-days switch and the Week / Month switch. On a phone it wraps to two rows.
 */
const CalendarToolbar: React.FC<CalendarToolbarProps> = ({
  period,
  conflicts,
  view,
  day = false,
  onView,
  onPrev,
  onNext,
  onToday,
  workdaysOnly,
  onWorkdaysOnly,
  onNewEvent,
  newEventOpen = false,
}) => {
  const { t } = useDashboardLang();
  const { nameOf } = useSpaceNames();
  const week = view === 'week';
  const prev = week ? (day ? t.prevDay : t.prevWeek) : t.prevMonth;
  const next = week ? (day ? t.nextDay : t.nextWeek) : t.nextMonth;
  return (
    <div className={styles.toolbar}>
      <h1 id="calendar-title" className={styles.title}>
        <span className="sr-only">{t.calendarTitle}: </span>
        {period}
      </h1>
      <div role="group" aria-label={t.periodLabel} className={styles.steps}>
        <button type="button" className={cx(styles.step, styles.square)} aria-label={prev} onClick={onPrev}>
          <DashIcon name="prev" size={16} />
        </button>
        <button type="button" className={styles.step} onClick={onToday}>
          {t.today}
        </button>
        <button type="button" className={cx(styles.step, styles.square)} aria-label={next} onClick={onNext}>
          <DashIcon name="next" size={16} />
        </button>
      </div>
      <div className={styles.right}>
        <ul className={styles.legend}>
          {SPACES.map((space) => (
            <li key={space} className={styles.item}>
              <span aria-hidden="true" className={styles.dot} data-for={space} />
              {nameOf(space)}
            </li>
          ))}
          <li className={styles.item}>
            <span aria-hidden="true" className={styles.hatch} />
            {t.busyNoDetails}
          </li>
        </ul>
        {conflicts > 0 && (
          <p className={styles.conflicts}>
            <DashIcon name="alert" size={14} />
            <span>
              {t.conflicts}: {conflicts}
            </span>
          </p>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={workdaysOnly}
          className={styles.switch}
          onClick={() => onWorkdaysOnly(!workdaysOnly)}
        >
          <span aria-hidden="true" className={styles.track}>
            <span className={styles.thumb} />
          </span>
          {t.workdaysOnly}
        </button>
        {onNewEvent && (
          <button type="button" className={styles.newEvent} aria-expanded={newEventOpen} onClick={onNewEvent}>
            {t.newEvent}
          </button>
        )}
        <div role="group" aria-label={t.viewLabel} className={styles.view}>
          <button type="button" aria-pressed={week} className={cx(styles.option, week && styles.on)} onClick={() => onView('week')}>
            {t.week}
          </button>
          <button type="button" aria-pressed={!week} className={cx(styles.option, !week && styles.on)} onClick={() => onView('month')}>
            {t.month}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CalendarToolbar;
