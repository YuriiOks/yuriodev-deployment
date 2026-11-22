import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { dayOfMonth, groupByDate, isWeekend, monthMatrix } from '../../../services/dashboards/calendarDates';
import { dateLabel, fill } from '../../../services/dashboards/calendarLabels';
import type { CalEvent } from '../../../services/dashboards/types';
import type { Conflicts } from '../../../services/dashboards/weekLayout';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import styles from './MonthGrid.module.css';

export interface MonthGridProps {
  year: number;
  /** 1-12. */
  month: number;
  today: string;
  events: readonly CalEvent[];
  conflicts: Conflicts;
  /** A day was picked: the calendar goes to the week that contains it. */
  onPickDay: (date: string) => void;
  /** Monday to Friday only. */
  workdaysOnly?: boolean;
}

/** How many event rows a day shows before "+N". */
const MAX_ROWS = 3;

/**
 * A month as a grid of weeks, Monday first. Each day is a button (a 44px-plus target) named by its date and its
 * number of events. A day of the month lists its events as rows (a 6px dot in the space's colour, the title with
 * an ellipsis, the start time at the right), three at most, then "+N"; the conflict mark is a warn triangle beside
 * the number. A neighbouring month's days are quieter still: grey numerals and up to three dots, no rows. Today's
 * number is a filled neutral circle; weekends take the week view's tint. A phone shows dots for every day.
 */
const MonthGrid: React.FC<MonthGridProps> = ({ year, month, today, events, conflicts, onPickDay, workdaysOnly = false }) => {
  const { t, text } = useDashboardLang();
  const byDate = groupByDate(events);

  return (
    <div role="region" aria-label={t.monthCaption} tabIndex={0} className={styles.scroll}>
      <table className={cx(styles.table, workdaysOnly && styles.five)}>
        <thead>
          <tr>
            {t.weekdaysShort.slice(0, workdaysOnly ? 5 : 7).map((name) => (
              <th key={name} scope="col" className={styles.weekday}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthMatrix(year, month, workdaysOnly).map((week) => (
            <tr key={week[0].date}>
              {week.map(({ date, inMonth }) => {
                const day = byDate.get(date) ?? [];
                const conflict = day.some((event) => conflicts.ids.has(event.id));
                const label = [
                  fill(t.dayLabel, { date: dateLabel(date, t), n: day.length }),
                  conflict ? t.dayConflict : '',
                ]
                  .filter(Boolean)
                  .join(', ');
                const isToday = date === today;
                return (
                  <td
                    key={date}
                    className={cx(styles.cell, isToday && styles.today, isWeekend(date) && styles.weekend)}
                    data-muted={inMonth ? undefined : 'true'}
                  >
                    <button
                      type="button"
                      className={styles.day}
                      aria-label={label}
                      aria-current={isToday ? 'date' : undefined}
                      data-conflict={conflict ? 'true' : undefined}
                      onClick={() => onPickDay(date)}
                    >
                      <span className={styles.top}>
                        <span className={styles.number}>{dayOfMonth(date)}</span>
                        {conflict && <DashIcon name="alert" size={14} className={styles.alert} />}
                      </span>
                      {inMonth && (
                        <span className={styles.rows}>
                          {day.slice(0, MAX_ROWS).map((event) => (
                            <span key={event.id} className={styles.row} data-for={event.space}>
                              <span aria-hidden="true" className={styles.dotMark} />
                              <span className={styles.title}>{text(event.title)}</span>
                              <span className={styles.time}>{event.start}</span>
                            </span>
                          ))}
                          {day.length > MAX_ROWS && <span className={styles.more}>{fill(t.more, { n: day.length - MAX_ROWS })}</span>}
                        </span>
                      )}
                      <span className={styles.dots}>
                        {day.slice(0, MAX_ROWS).map((event) => (
                          <span key={event.id} aria-hidden="true" className={styles.dotMark} data-for={event.space} />
                        ))}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default MonthGrid;
