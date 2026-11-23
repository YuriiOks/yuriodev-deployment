import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { useSpaceNames } from '../../../hooks/useSpaceNames';
import { dayOfMonth, isWeekend, weekdayIndex } from '../../../services/dashboards/calendarDates';
import { nowOffsetHours } from '../../../services/dashboards/nowLine';
import type { CalEvent } from '../../../services/dashboards/types';
import { arrangeDay, layoutDay, toMinutes, type Conflicts } from '../../../services/dashboards/weekLayout';
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
  /** The current time: draws the now line on today's column (inside the grid's hours). Left out, no line. */
  now?: Date;
}

/** A block this short (minutes) is one line: its title, then its start time. */
const SHORT_MINUTES = 45;

/** From this length a block may wrap its title over three lines instead of two. */
const TALL_MINUTES = 90;

/** Inline custom properties: the numbers the stylesheet turns into positions. */
const vars = (values: Record<string, string | number>) => values as React.CSSProperties;

/**
 * A week (or one day) as a table: days are columns, hours run down the page. Each event is a block placed by
 * its start time and as tall as it lasts: an opaque tint of its space's colour with a 3px bar of the ink at the
 * left, the title first and the time under it (a short block: one line). Events that overlap in a day sit side
 * by side (two) or, from three, in a cascade, each later start indented one step (weekLayout.ts); every day has
 * the same width. An overlap between two spaces is marked with a ring, an icon and words. Today is a filled
 * number in the header and, with `now`, a line on its column.
 */
const WeekGrid: React.FC<WeekGridProps> = ({ dates, today, hours, events, conflicts, now }) => {
  const { t, text } = useDashboardLang();
  const { nameOf } = useSpaceNames();
  const firstMinute = toMinutes(hours[0]);
  const endLabel = `${String(Math.floor((toMinutes(hours[hours.length - 1]) + 60) / 60)).padStart(2, '0')}:00`;
  const single = dates.length === 1;
  const nowOffset = now ? nowOffsetHours(now, hours) : null;

  // Every day has the same width, as in a calendar; a day's own overlapping events share its column.
  const days = dates.map((date) => ({ date, ...arrangeDay(layoutDay(events.filter((event) => event.date === date))) }));

  return (
    <div className={styles.scroll}>
      <div role="region" aria-label={t.calendarCaption} tabIndex={0} className={cx(styles.scroller, single && styles.singleScroller)}>
        <table className={cx(styles.table, single && styles.single, dates.length === 5 && styles.five)} style={vars({ '--hours': hours.length })}>
          <colgroup>
            <col className={styles.gutterCol} />
            {days.map(({ date }) => (
              <col key={date} style={single ? undefined : { width: `${(95 / days.length).toFixed(3)}%` }} />
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
                  <span className={styles.weekday}>{t.weekdaysShort[weekdayIndex(date)]}</span>{' '}
                  <span className={styles.number}>{dayOfMonth(date)}</span>
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
              {days.map(({ date, placements, stacks }) => (
                <td key={date} className={cx(styles.column, isWeekend(date) && styles.weekend)}>
                  <ul className={styles.events}>
                    {placements.map(({ event, startMin, endMin, level, slot, slots }) => {
                      const conflict = conflicts.ids.has(event.id);
                      const minutes = endMin - startMin;
                      const short = minutes < SHORT_MINUTES;
                      const space = nameOf(event.space);
                      const title = text(event.title);
                      const range = `${event.start}–${event.end}`;
                      return (
                        <li
                          key={event.id}
                          className={styles.event}
                          data-for={event.space}
                          data-conflict={conflict ? 'true' : undefined}
                          data-short={short ? 'true' : undefined}
                          data-tall={minutes >= TALL_MINUTES ? 'true' : undefined}
                          data-note={event.note ? 'true' : undefined}
                          title={[`${space}: ${range} ${title}`, event.note ? text(event.note) : ''].filter(Boolean).join(' · ')}
                          style={vars({
                            '--top': (startMin - firstMinute) / 60,
                            '--span': minutes / 60,
                            '--level': level,
                            '--slot': slot,
                            '--slots': slots,
                          })}
                        >
                          <span className="sr-only">
                            {space}: {conflict ? `${t.conflictMark}. ` : ''}
                            {range}.
                          </span>
                          <span aria-hidden="true" className={styles.name}>
                            {title}
                          </span>
                          <span aria-hidden="true" className={styles.time}>
                            {short ? event.start : range}
                          </span>
                          {event.note && <span className="sr-only">{text(event.note)}</span>}
                          {conflict && <DashIcon name="alert" size={14} className={styles.alert} />}
                        </li>
                      );
                    })}
                    {stacks.map((stack) => {
                      const names = stack.hidden.map((event) => `${event.start}–${event.end} ${text(event.title)}`);
                      const marked = stack.hidden.some((event) => conflicts.ids.has(event.id));
                      return (
                        <li
                          key={stack.hidden.map((event) => event.id).join('+')}
                          className={styles.event}
                          data-stack="true"
                          data-conflict={marked ? 'true' : undefined}
                          title={names.join(' · ')}
                          style={vars({
                            '--top': (stack.startMin - firstMinute) / 60,
                            '--span': Math.max(stack.endMin - stack.startMin, 30) / 60,
                            '--level': stack.level,
                            '--slot': stack.slot,
                            '--slots': stack.slots,
                          })}
                        >
                          <span className="sr-only">
                            {t.moreEvents.replace('{n}', String(stack.hidden.length))}: {marked ? `${t.conflictMark}. ` : ''}
                            {names.join('; ')}
                          </span>
                          <span aria-hidden="true" className={styles.name}>
                            +{stack.hidden.length}
                          </span>
                        </li>
                      );
                    })}
                    {date === today && nowOffset !== null && (
                      <li aria-hidden="true" className={styles.now} style={vars({ '--now': nowOffset })} />
                    )}
                  </ul>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default WeekGrid;
