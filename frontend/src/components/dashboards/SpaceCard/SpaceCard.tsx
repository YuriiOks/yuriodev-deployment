import React from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { pagePath } from '../../../data/site';
import { SPACE_NAME, SPACE_PAGE } from '../../../services/dashboards/spaces';
import type { SpaceData, SpaceSummary } from '../../../services/dashboards/types';
import { cx } from '../../../utils/cx';
import SpaceTile from '../SpaceTile/SpaceTile';
import styles from './SpaceCard.module.css';

export interface SpaceCardProps {
  space: SpaceData;
  summary: SpaceSummary;
}

/**
 * One entrance card, and all of it is the link (the title's link is stretched over the card): the space's tile
 * and name, three plain counters, and what is next. Never a task. Open and priority are ink, zero is quiet,
 * only overdue above zero is danger (and says so in words).
 */
const SpaceCard: React.FC<SpaceCardProps> = ({ space, summary }) => {
  const { t, text } = useDashboardLang();
  const name = text(SPACE_NAME[space.id]);
  const titleId = `hub-${space.id}-title`;
  const stats: ReadonlyArray<readonly [number, string, boolean]> = [
    [summary.open, t.statOpen, false],
    [summary.priority, t.statPriority, false],
    [summary.overdue, t.statOverdue, summary.overdue > 0],
  ];

  return (
    <section aria-labelledby={titleId} className={styles.card} data-card={space.id}>
      <div className={styles.head}>
        <SpaceTile space={space.id} />
        <h2 id={titleId} className={styles.name}>
          <Link to={pagePath(SPACE_PAGE[space.id])} className={styles.link}>
            {name}
          </Link>
        </h2>
      </div>
      <ul className={styles.stats}>
        {stats.map(([value, label, alarm]) => (
          <li key={label} className={styles.stat}>
            <span className={cx(styles.number, value === 0 && styles.zero, alarm && styles.alarm)}>{value}</span>
            <span className={styles.label}>{label}</span>
          </li>
        ))}
      </ul>
      <p className={styles.next}>
        {t.next}: <span className={styles.at}>{space.hero.at}</span> {text(space.hero.title)}
      </p>
    </section>
  );
};

export default SpaceCard;
