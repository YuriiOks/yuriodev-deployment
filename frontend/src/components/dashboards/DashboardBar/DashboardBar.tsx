import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { pagePath, type PageId } from '../../../data/site';
import { SPACES, SPACE_NAME, SPACE_PAGE } from '../../../services/dashboards/spaces';
import type { SpaceId } from '../../../services/dashboards/types';
import { cx } from '../../../utils/cx';
import LangSwitch from '../LangSwitch/LangSwitch';
import styles from './DashboardBar.module.css';

export interface DashboardBarProps {
  /** The space on screen; none on the entrance and the calendar. */
  space?: SpaceId;
}

const navClass = ({ isActive }: { isActive: boolean }) => cx(styles.link, isActive && styles.active);

/**
 * The dashboards' own bar: where you are (yuriodev/dashboards/work-1), the
 * five pages, and the language switch. Theme is the site header's toggle.
 */
const DashboardBar: React.FC<DashboardBarProps> = ({ space }) => {
  const { t, text } = useDashboardLang();
  const items: ReadonlyArray<readonly [PageId, string]> = [
    ['dashboards', t.navAll],
    ...SPACES.map((id) => [SPACE_PAGE[id], text(SPACE_NAME[id])] as const),
    ['dashboards-calendar', t.navCalendar],
  ];

  return (
    <div className={styles.bar}>
      <p className={styles.where}>
        <Link to={pagePath('dashboards')} className={styles.home}>
          yuriodev/dashboards
        </Link>
        {space && <span className={styles.segment}>/{space}</span>}
      </p>
      <nav aria-label={t.navLabel} className={styles.nav}>
        {items.map(([id, label]) => (
          <NavLink key={id} to={pagePath(id)} end className={navClass}>
            {label}
          </NavLink>
        ))}
      </nav>
      <LangSwitch />
    </div>
  );
};

export default DashboardBar;
