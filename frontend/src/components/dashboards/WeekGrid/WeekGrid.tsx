import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { SPACE_NAME } from '../../../services/dashboards/spaces';
import { dayOfMonth } from '../../../services/dashboards/calendarDates';
import type { CalEvent } from '../../../services/dashboards/types';
import { layoutDay, toMinutes, type Conflicts } from '../../../services/dashboards/weekLayout';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import styles from './WeekGrid.module.css';

export interface WeekGridProps {
  /** The seven dates of the week, Monday first. */
  dates: readonly string[];
  /** The date shown as today. */
  today: string;
  /** The hours shown, as "HH:00". */
  hours: readonly string[];
  /** The week's events (any others are ignored). */
  events: readonly CalEvent[];
  /** Which events overlap an event of another space (services/dashboards/weekLayout.ts). */
  conflicts: Conflicts;
}

/** From this many side-by-side events the column is too narrow for the time, which then is read aloud only. */
const DENSE_COLUMNS = 3;

/** An event this short (minutes) is one line, cut with an ellipsis. */
const SHORT_MINUTES = 30;

/**
 * A week as a table: days are columns, hours run down the page. Each event is
 * a block placed by its start time, as tall as it lasts, in its space's colour.
 * Events that overlap in a day sit side by side, sharing the width equally
 * (layoutDay); an overlap between two spaces is marked with an icon and said
 * in words. On a narrow screen the grid scrolls sideways inside its own box.
 */
const WeekGrid: React.FC<WeekGridProps> = ({ dates, today, hours, events, conflicts }) => {
  const { t, text } = useDashboardLang();
  const firstMinute = toMinutes(hours[0]);
  /** Inline custom properties: the numbers the stylesheet turns into positions. */
const vars = (values: Record<string, string | number>) => values as React.CSSProperties;

  return (
    <div role="region" aria-label={t.calendarCaption} tabIndex={0} className={styles.scroll}>
      <table className={styles.table} style={vars({ '--hours': hours.length })}>
        <thead>
          <tr>
            <td className={styles.corner} />
            {dates.map((date, index) => (
              <th
                key={date}
                scope="col"
                aria-current={date === today ? 'date' : undefined}
                className={cx(styles.day, date === today && styles.today)}
              >
                {t.weekdaysShort[index]} {dayOfMonth(date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td aria-hidden="true" className={styles.gutter}>
              {hours.map((hour, index) => (
                <span key={hour} className={styles.hour} style={vars({ '--i': index })}>
                  {hour}
                </span>
              ))}
            </td>
            {dates.map((date) => {
              const placed = layoutDay(events.filter((event) => event.date === date));
              return (
                <td key={date} className={cx(styles.column, date === today && styles.today)}>
                  <ul className={styles.events}>
                    {placed.map(({ event, startMin, endMin, column, columns }) => {
                      const conflict = conflicts.ids.has(event.id);
                      const dense = columns >= DENSE_COLUMNS;
                      const name = `${text(SPACE_NAME[event.space])}: ${event.start}–${event.end} ${text(event.title)}`;
                      return (
                        <li
                          key={event.id}
                          className={styles.event}
                          data-for={event.space}
                          data-conflict={conflict ? 'true' : undefined}
                          data-short={endMin - startMin <= SHORT_MINUTES ? 'true' : undefined}
                          title={name}
                          style={vars({
                            '--top': (startMin - firstMinute) / 60,
                            '--span': (endMin - startMin) / 60,
                            '--col': column,
                            '--cols': columns,
                          })}
                        >
                          <span className={styles.name}>
                            <span className="sr-only">{text(SPACE_NAME[event.space])}: </span>
                            {conflict && (
                              <>
                                <DashIcon name="alert" size={12} strokeWidth={2.2} className={styles.alert} />
                                <span className="sr-only">{t.conflictMark}. </span>
                              </>
                            )}
                            <span className={dense ? 'sr-only' : styles.time}>
                              {event.start}–{event.end}{' '}
                            </span>
                            {text(event.title)}
                          </span>
                          {event.note && <span className={styles.note}>{text(event.note)}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default WeekGrid;
