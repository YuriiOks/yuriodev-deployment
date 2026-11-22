import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { SPACE_ICON, SPACE_NAME } from '../../../services/dashboards/spaces';
import type { SpaceData } from '../../../services/dashboards/types';
import DashIcon from '../DashIcon/DashIcon';
import styles from './SpaceHero.module.css';

export interface SpaceHeroProps {
  space: SpaceData;
}

/** The top of a space: its name (the page's h1), the next event with a countdown, a Join button, and the day's events. */
const SpaceHero: React.FC<SpaceHeroProps> = ({ space }) => {
  const { t, text } = useDashboardLang();
  const { hero } = space;

  return (
    <section aria-labelledby={`${space.id}-title`} className={styles.hero}>
      <span className={styles.badge}>
        <DashIcon name={SPACE_ICON[space.id]} size={30} />
      </span>
      <div className={styles.next}>
        <h1 id={`${space.id}-title`} className={styles.name}>
          {text(SPACE_NAME[space.id])}
        </h1>
        <p className={styles.label}>{text(hero.label)}</p>
        <p className={styles.event}>
          <span className={styles.at}>{hero.at}</span> {text(hero.title)}
        </p>
      </div>
      <p className={styles.countdown}>
        <span className={styles.in}>{t.inWord} </span>
        {hero.countdown}
      </p>
      {hero.join && (
        <button type="button" className={styles.join}>
          {t.join}
        </button>
      )}
      <div className={styles.day}>
        <ul className={styles.events}>
          {hero.day.map((event) => (
            <li key={`${event.at}-${event.title.en}`} className={styles.chip}>
              <span className={styles.chipAt}>{event.at}</span>
              {text(event.title)}
            </li>
          ))}
        </ul>
        <p className={styles.sync}>{text(hero.sync)}</p>
      </div>
    </section>
  );
};

export default SpaceHero;
