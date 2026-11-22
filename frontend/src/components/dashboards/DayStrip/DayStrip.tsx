import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { dayOfMonth, groupByDate, weekdayIndex } from '../../../services/dashboards/calendarDates';
import { dateLabel, fill } from '../../../services/dashboards/calendarLabels';
import type { CalEvent } from '../../../services/dashboards/types';
import type { Conflicts } from '../../../services/dashboards/weekLayout';
import { cx } from '../../../utils/cx';
import styles from './DayStrip.module.css';

export interface DayStripProps {
  /** The week's days, Monday first (five or seven). */
  dates: readonly string[];
  /** The day on screen. */
  selected: string;
  today: string;
  events: readonly CalEvent[];
  conflicts: Conflicts;
  onPick: (date: string) => void;
}

/**
 * A phone shows one day at a time; this strip above it shows the whole week: a 44px cell per day (the weekday over
 * the number), the selected day underlined, today's number in the neutral circle, and a dot under each day that has
 * events (warn-coloured when one of them conflicts). Each cell is a button named by its date and event count.
 */
const DayStrip: React.FC<DayStripProps> = ({ dates, selected, today, events, conflicts, onPick }) => {
  const { t } = useDashboardLang();
  const byDate = groupByDate(events);
  return (
    <div role="group" aria-label={t.weekDaysLabel} className={styles.strip}>
      {dates.map((date) => {
        const day = byDate.get(date) ?? [];
        const conflict = day.some((event) => conflicts.ids.has(event.id));
        const label = [fill(t.dayLabel, { date: dateLabel(date, t), n: day.length }), conflict ? t.dayConflict : '']
          .filter(Boolean)
          .join(', ');
        return (
          <button
            key={date}
            type="button"
            className={cx(styles.cell, date === selected && styles.selected, date === today && styles.today)}
            aria-label={label}
            aria-pressed={date === selected}
            aria-current={date === today ? 'date' : undefined}
            onClick={() => onPick(date)}
          >
            <span className={styles.weekday}>{t.weekdaysShort[weekdayIndex(date)]}</span>
            <span className={styles.number}>{dayOfMonth(date)}</span>
            <span aria-hidden="true" className={styles.dot} data-has={day.length > 0 ? 'true' : undefined} data-conflict={conflict ? 'true' : undefined} />
          </button>
        );
      })}
    </div>
  );
};

export default DayStrip;
