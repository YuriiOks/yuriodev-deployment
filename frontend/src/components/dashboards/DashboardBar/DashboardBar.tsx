import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { pagePath, type PageId } from '../../../data/site';
import { SPACES, SPACE_NAME, SPACE_PAGE } from '../../../services/dashboards/spaces';
import { cx } from '../../../utils/cx';
import LangSwitch from '../LangSwitch/LangSwitch';
import ThemeToggle from '../ThemeToggle/ThemeToggle';
import styles from './DashboardBar.module.css';

const navClass = ({ isActive }: { isActive: boolean }) => cx(styles.link, isActive && styles.active);

/**
 * The dashboards' only chrome (the site's header is not on these pages): a
 * link back to the site, the five pages, the language switch and the theme
 * toggle. On a narrow screen the pages become one scrollable row under the
 * brand and the two switches.
 */
const DashboardBar: React.FC = () => {
  const { t, text } = useDashboardLang();
  const items: ReadonlyArray<readonly [PageId, string]> = [
    ['dashboards', t.navAll],
    ...SPACES.map((id) => [SPACE_PAGE[id], text(SPACE_NAME[id])] as const),
    ['dashboards-calendar', t.navCalendar],
  ];

  return (
    <div className={styles.bar}>
      <Link to="/" className={styles.brand} aria-label={t.backToSite}>
        yuriodev
      </Link>
      <nav aria-label={t.navLabel} className={styles.nav}>
        {items.map(([id, label]) => (
          <NavLink key={id} to={pagePath(id)} end className={navClass}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className={styles.tools}>
        <LangSwitch />
        <ThemeToggle />
      </div>
    </div>
  );
};

export default DashboardBar;
