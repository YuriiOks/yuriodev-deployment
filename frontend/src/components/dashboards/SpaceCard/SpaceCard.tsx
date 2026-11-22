import React from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { pagePath } from '../../../data/site';
import { SPACE_ICON, SPACE_NAME, SPACE_PAGE } from '../../../services/dashboards/spaces';
import type { SpaceData, SpaceSummary } from '../../../services/dashboards/types';
import DashIcon from '../DashIcon/DashIcon';
import styles from './SpaceCard.module.css';

export interface SpaceCardProps {
  space: SpaceData;
  summary: SpaceSummary;
}

/** One entrance card: the space, its three counters, what is next, and the way in. Never a task. */
const SpaceCard: React.FC<SpaceCardProps> = ({ space, summary }) => {
  const { t, text } = useDashboardLang();
  const name = text(SPACE_NAME[space.id]);
  const path = pagePath(SPACE_PAGE[space.id]);
  const titleId = `hub-${space.id}-title`;

  return (
    <section aria-labelledby={titleId} className={styles.card} data-card={space.id}>
      <div className={styles.head}>
        <span className={styles.badge}>
          <DashIcon name={SPACE_ICON[space.id]} size={28} />
        </span>
        <div className={styles.titles}>
          <h2 id={titleId} className={styles.name}>
            {name}
          </h2>
        </div>
      </div>
      <p className={styles.about}>{text(space.about)}</p>
      <ul className={styles.stats}>
        <li className={styles.stat}>
          <span className={styles.number}>{summary.open}</span>
          <span className={styles.label}>{t.statOpen}</span>
        </li>
        <li className={styles.stat}>
          <span className={styles.number} data-kind="priority">{summary.priority}</span>
          <span className={styles.label}>{t.statPriority}</span>
        </li>
        <li className={styles.stat}>
          <span className={styles.number} data-kind={summary.overdue > 0 ? 'overdue' : 'none'}>{summary.overdue}</span>
          <span className={styles.label}>{t.statOverdue}</span>
        </li>
      </ul>
      <p className={styles.next}>
        <span className={styles.nextLabel}>{t.next}: </span>
        <span className={styles.nextText}>
          {space.hero.at} {text(space.hero.title)}
        </span>
      </p>
      <Link to={path} className={styles.open}>
        {t.open} {name}
      </Link>
    </section>
  );
};

export default SpaceCard;
