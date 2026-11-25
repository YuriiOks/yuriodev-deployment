import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { TodayStreak } from '../../../services/dashboards/todayApi';
import styles from './Today.module.css';

/**
 * "Queue cleared": the seven days of the week as cells (a cleared day filled, an open one empty, a day with no data dotted and one still ahead
 * faint, today outlined), each with its weekday letter and its state in words for a screen reader, under a headline: the run of cleared days, or how
 * many days of the week so far were cleared. Not drawn when every day is without data (nothing to say).
 */
const StreakCard: React.FC<{ streak: TodayStreak; today: string }> = ({ streak, today }) => {
  const { t, lang } = useDashboardLang();
  const s = t.streak;
  if (streak.days.every((day) => day.state === 'no_data')) return null;
  const seen = streak.days.filter((day) => day.state === 'cleared' || day.state === 'open');
  const cleared = seen.filter((day) => day.state === 'cleared').length;
  const headline = streak.count > 0 ? fill(s.row, { n: streak.count }) : cleared > 0 ? fill(s.week, { cleared, total: seen.length }) : s.none;
  return (
    <div className={styles.sideCard} role="region" aria-label={s.title}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{s.title}</h3>
        <span className={styles.sideWhen}>{s.subtitle}</span>
      </div>
      <strong className={styles.streakHeadline}>{headline}</strong>
      <ul className={styles.week}>
        {streak.days.map((day, index) => (
          <li key={day.date} className={styles.day} data-state={day.state} data-today={day.date === today ? 'true' : undefined}>
            <span aria-hidden="true" className={styles.cell} />
            <span aria-hidden="true" className={styles.dayLetter}>
              {s.dayLetters[index] ?? ''}
            </span>
            <span className="sr-only">
              {new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(new Date(`${day.date}T12:00:00`))}: {s.states[day.state]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default StreakCard;
