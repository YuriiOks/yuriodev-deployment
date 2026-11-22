import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { SPACE_NAME } from '../../../services/dashboards/spaces';
import { dayOfMonth, weekdayIndex } from '../../../services/dashboards/calendarDates';
import type { CalEvent } from '../../../services/dashboards/types';
import { layoutDay, toMinutes, type Conflicts } from '../../../services/dashboards/weekLayout';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import styles from './WeekGrid.module.css';

export interface WeekGridProps {
  /** The dates shown, Monday first: the seven of a week, or one (a phone shows a day at a time). */
  dates: readonly string[];
  /** The date shown as today. */
  today: string;
  /** The hours shown, as "HH:00". */
  hours: readonly string[];
  /** The events of those dates (any others are ignored). */
  events: readonly CalEvent[];
  /** Which events overlap an event of another space (services/dashboards/weekLayout.ts). */
  conflicts: Conflicts;
}

/** From this many side-by-side events a block is too narrow for anything but its title. */
const DENSE_COLUMNS = 3;

/** An event this short (minutes) is one line; one at least TALL_MINUTES long also has room for its note. */
const SHORT_MINUTES = 30;
const TALL_MINUTES = 60;

/** Inline custom properties: the numbers the stylesheet turns into positions. */
const vars = (values: Record<string, string | number>) => values as React.CSSProperties;

/**
 * A week (or one day) as a table: days are columns, hours run down the page.
 * Each event is a block placed by its start time, as tall as it lasts, in its
 * space's colour. Events that overlap in a day sit side by side, sharing the
 * width of the day equally (layoutDay); a day with a crowded cluster gets a
 * wider column. An overlap between two spaces is marked with an icon, a
 * dashed edge and words. On a narrow screen the week scrolls sideways inside
 * its own box (or the page shows one day).
 */
const WeekGrid: React.FC<WeekGridProps> = ({ dates, today, hours, events, conflicts }) => {
  const { t, text } = useDashboardLang();
  const firstMinute = toMinutes(hours[0]);
  const endLabel = `${String(Math.floor((toMinutes(hours[hours.length - 1]) + 60) / 60)).padStart(2, '0')}:00`;
  const single = dates.length === 1;

  const days = dates.map((date) => {
    const placed = layoutDay(events.filter((event) => event.date === date));
    const widest = placed.reduce((most, p) => Math.max(most, p.columns), 1);
    // A crowded day gets a wider column (one lane 1.3, two 1.8, three or more 2.3); an empty day a narrower one.
    const weight = placed.length === 0 ? 0.6 : [1.3, 1.8, 2.3][Math.min(widest, 3) - 1];
    return { date, placed, weight };
  });
  const totalWeight = days.reduce((sum, day) => sum + day.weight, 0);

  return (
    <div role="region" aria-label={t.calendarCaption} tabIndex={0} className={styles.scroll}>
      <table className={cx(styles.table, single && styles.single)} style={vars({ '--hours': hours.length })}>
        <colgroup>
          <col className={styles.gutterCol} />
          {days.map(({ date, weight }) => (
            <col key={date} style={single ? undefined : { width: `${((weight / totalWeight) * 95).toFixed(3)}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td className={styles.corner} />
            {days.map(({ date }) => (
              <th
                key={date}
                scope="col"
                aria-current={date === today ? 'date' : undefined}
                className={cx(styles.day, date === today && styles.today)}
              >
                {t.weekdaysShort[weekdayIndex(date)]} {dayOfMonth(date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td aria-hidden="true" className={styles.gutter}>
              {[...hours, endLabel].map((hour, index) => (
                <span key={hour} className={styles.hour} style={vars({ '--i': index })}>
                  {hour}
                </span>
              ))}
            </td>
            {days.map(({ date, placed }) => (
              <td key={date} className={cx(styles.column, date === today && styles.today)}>
                <ul className={styles.events}>
                  {placed.map(({ event, startMin, endMin, column, columns }) => {
                    const conflict = conflicts.ids.has(event.id);
                    const minutes = endMin - startMin;
                    const dense = columns >= DENSE_COLUMNS;
                    const short = minutes <= SHORT_MINUTES;
                    // The full range only where the block has the whole day's width; otherwise the start alone.
                    const startOnly = short || columns > 1;
                    const wrap = !short && columns === 1;
                    const showNote = Boolean(event.note) && !short && !dense && minutes >= TALL_MINUTES;
                    const space = text(SPACE_NAME[event.space]);
                    const title = text(event.title);
                    const range = `${event.start}–${event.end}`;
                    return (
                      <li
                        key={event.id}
                        className={styles.event}
                        data-for={event.space}
                        data-conflict={conflict ? 'true' : undefined}
                        data-short={short ? 'true' : undefined}
                        data-dense={dense ? 'true' : undefined}
                        data-wrap={wrap ? 'true' : undefined}
                        data-note={event.note ? 'true' : undefined}
                        title={[`${space}: ${range} ${title}`, event.note ? text(event.note) : ''].filter(Boolean).join(' · ')}
                        style={vars({
                          '--top': (startMin - firstMinute) / 60,
                          '--span': minutes / 60,
                          '--col': column,
                          '--cols': columns,
                        })}
                      >
                        <span className="sr-only">
                          {space}: {conflict ? `${t.conflictMark}. ` : ''}
                          {range}.
                        </span>
                        {(!dense || conflict) && (
                          <span aria-hidden="true" className={styles.head}>
                            {!dense && <span className={styles.time}>{startOnly ? event.start : range}</span>}
                            {conflict && <DashIcon name="alert" size={12} strokeWidth={2.2} className={styles.alert} />}
                          </span>
                        )}
                        <span className={styles.name}>{title}</span>
                        {event.note && (showNote ? <span className={styles.note}>{text(event.note)}</span> : <span className="sr-only">{text(event.note)}</span>)}
                      </li>
                    );
                  })}
                </ul>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default WeekGrid;
