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
 * A month as a grid of weeks, Monday first, in the week view's design (WeekGrid.module.css): the same glass frame, header row,
 * hairlines, weekend tint and today's filled number. Each day is a button (a 44px-plus target) named by its date and its
 * number of events. A day of the month lists its events as the week's blocks at chip size (an opaque tint of the space's
 * colour with a 3px ink bar at the left, the title with an ellipsis and the start time at the right, a warn ring for a
 * conflict, hatching for a busy-only one), three at most, then "+N" (the day opens in the week view). A neighbouring
 * month's days are quieter: grey numerals and up to three dots. A phone shows dots for every day.
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
                            <span
                              key={event.id}
                              className={styles.event}
                              data-for={event.space}
                              data-conflict={conflicts.ids.has(event.id) ? 'true' : undefined}
                              data-note={event.note ? 'true' : undefined}
                            >
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
