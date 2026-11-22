import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { SPACE_NAME } from '../../../services/dashboards/spaces';
import type { WeekData } from '../../../services/dashboards/types';
import { layoutDay, toMinutes, type Conflicts } from '../../../services/dashboards/weekLayout';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import styles from './WeekGrid.module.css';

export interface WeekGridProps {
  week: WeekData;
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
const WeekGrid: React.FC<WeekGridProps> = ({ week, conflicts }) => {
  const { t, text } = useDashboardLang();
  const firstMinute = toMinutes(week.hours[0]);
  /** Inline custom properties: the numbers the stylesheet turns into positions. */
const vars = (values: Record<string, string | number>) => values as React.CSSProperties;

  return (
    <div role="region" aria-label={t.calendarCaption} tabIndex={0} className={styles.scroll}>
      <table className={styles.table} style={vars({ '--hours': week.hours.length })}>
        <thead>
          <tr>
            <td className={styles.corner} />
            {week.days.map((day) => (
              <th
                key={day.label.en}
                scope="col"
                aria-current={day.today ? 'date' : undefined}
                className={cx(styles.day, day.today && styles.today)}
              >
                {text(day.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td aria-hidden="true" className={styles.gutter}>
              {week.hours.map((hour, index) => (
                <span key={hour} className={styles.hour} style={vars({ '--i': index })}>
                  {hour}
                </span>
              ))}
            </td>
            {week.days.map((day, dayIndex) => {
              const placed = layoutDay(week.events.filter((event) => event.day === dayIndex));
              return (
                <td key={day.label.en} className={cx(styles.column, day.today && styles.today)}>
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
