import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { dayOfMonth, groupByDate, monthMatrix } from '../../../services/dashboards/calendarDates';
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
}

/** How many event chips a day shows before "+N more". */
const MAX_CHIPS = 3;

/**
 * A month as a grid of weeks, Monday first. The days of the neighbouring
 * months that fill the first and last week are shown muted. Each day is a
 * button (a 44px-plus target) named by its date and its number of events; it
 * shows up to three chips, then "+N more", and the conflict mark when an
 * overlap between two spaces falls on it.
 */
const MonthGrid: React.FC<MonthGridProps> = ({ year, month, today, events, conflicts, onPickDay }) => {
  const { t, text } = useDashboardLang();
  const byDate = groupByDate(events);

  return (
    <div role="region" aria-label={t.monthCaption} tabIndex={0} className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {t.weekdaysShort.map((name) => (
              <th key={name} scope="col" className={styles.weekday}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthMatrix(year, month).map((week) => (
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
                  <td key={date} className={cx(styles.cell, isToday && styles.today)} data-muted={inMonth ? undefined : 'true'}>
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
                        {conflict && <DashIcon name="alert" size={14} strokeWidth={2.2} className={styles.alert} />}
                      </span>
                      {day.slice(0, MAX_CHIPS).map((event) => (
                        <span key={event.id} className={styles.chip} data-for={event.space}>
                          {event.start} {text(event.title)}
                        </span>
                      ))}
                      {day.length > MAX_CHIPS && (
                        <span className={styles.more}>{fill(t.more, { n: day.length - MAX_CHIPS })}</span>
                      )}
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
