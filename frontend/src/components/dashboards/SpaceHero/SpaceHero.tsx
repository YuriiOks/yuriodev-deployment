import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { SPACE_NAME } from '../../../services/dashboards/spaces';
import { countdownLabel } from '../../../services/dashboards/calendarLabels';
import type { Hero, SpaceId } from '../../../services/dashboards/types';
import SpaceTile from '../SpaceTile/SpaceTile';
import styles from './SpaceHero.module.css';

export interface SpaceHeroProps {
  space: SpaceId;
  /** The next event; null while it loads or when there is none (the strip then shows only the name). */
  hero: Hero | null;
}

/**
 * The top of a space, one 56px strip on the page with no box: the space tile and name (the page's h1), the
 * next event (the page's one 20px line: the time with the title), how long until it, what comes after (wide
 * screens), and Join when the event has a call. Whole minutes, never a ticking second.
 */
const SpaceHero: React.FC<SpaceHeroProps> = ({ space, hero }) => {
  const { t, text } = useDashboardLang();
  const after = hero?.day.find((event) => event.at > hero.at);

  return (
    <section aria-labelledby={`${space}-title`} className={styles.strip}>
      <span className={styles.tile}>
        <SpaceTile space={space} />
      </span>
      <h1 id={`${space}-title`} className={styles.name}>
        {text(SPACE_NAME[space])}
      </h1>
      {hero && (
        <>
          <p className={styles.event}>
            {hero.date && <span>{hero.date} </span>}
            <span className={styles.at}>{hero.at}</span> {text(hero.title)}
          </p>
          <p className={styles.left}>{countdownLabel(hero.minutesLeft, t)}</p>
        </>
      )}
      {after && (
        <p className={styles.then}>
          {t.thenWord} <span className={styles.thenAt}>{after.at}</span> {text(after.title)}
        </p>
      )}
      {hero?.join && (
        <button type="button" className={styles.join}>
          {t.join}
        </button>
      )}
    </section>
  );
};

export default SpaceHero;
