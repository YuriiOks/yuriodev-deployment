import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { SPACE_NAME } from '../../../services/dashboards/spaces';
import type { WeekData } from '../../../services/dashboards/types';
import { cx } from '../../../utils/cx';
import styles from './WeekGrid.module.css';

export interface WeekGridProps {
  week: WeekData;
}

/**
 * A week as a table: days are columns, hours are rows, each event sits in the
 * cell of its day and starting hour, in its space's colour. On a narrow
 * screen the grid scrolls sideways inside its own box.
 */
const WeekGrid: React.FC<WeekGridProps> = ({ week }) => {
  const { t, text } = useDashboardLang();

  return (
    <div role="region" aria-label={t.calendarCaption} tabIndex={0} className={styles.scroll}>
      <table className={styles.table}>
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
          {week.hours.map((hour) => (
            <tr key={hour}>
              <th scope="row" className={styles.hour}>
                {hour}
              </th>
              {week.days.map((day, dayIndex) => {
                const events = week.events.filter((e) => e.day === dayIndex && e.at.slice(0, 2) === hour.slice(0, 2));
                return (
                  <td key={day.label.en} className={cx(styles.cell, day.today && styles.today)}>
                    {events.length > 0 && (
                      <ul className={styles.events}>
                        {events.map((event) => (
                          <li key={event.id} className={styles.event} data-for={event.space}>
                            <span className={styles.name}>
                              <span className="sr-only">{text(SPACE_NAME[event.space])}: </span>
                              {event.at} {text(event.title)}
                            </span>
                            {event.note && <span className={styles.note}>{text(event.note)}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
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

export default WeekGrid;
