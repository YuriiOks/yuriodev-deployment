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

export interface DashboardBarProps {
  /** A phone: the bar is only the pages (no brand, no switches; the shell puts the switches at the page's end). */
  phone?: boolean;
}

/**
 * The dashboards' only chrome (the site's header is not on these pages), sticky at the top: the one place
 * that is glass, because the content scrolls under it. A link back to the site, a hairline divider, the five
 * pages as text links (the current one underlined in the space's colour), the language switch and the theme
 * toggle.
 */
const DashboardBar: React.FC<DashboardBarProps> = ({ phone = false }) => {
  const { t, text } = useDashboardLang();
  const items: ReadonlyArray<readonly [PageId, string]> = [
    ['dashboards', t.navAll],
    ...SPACES.map((id) => [SPACE_PAGE[id], text(SPACE_NAME[id])] as const),
    ['dashboards-calendar', t.navCalendar],
  ];

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        {!phone && (
          <>
            <Link to="/" className={styles.brand} aria-label={t.backToSite}>
              yuriodev
            </Link>
            <span aria-hidden="true" className={styles.divider} />
          </>
        )}
        <nav aria-label={t.navLabel} className={styles.nav}>
          {items.map(([id, label]) => (
            <NavLink key={id} to={pagePath(id)} end className={navClass}>
              {label}
            </NavLink>
          ))}
        </nav>
        {!phone && (
          <div className={styles.tools}>
            <LangSwitch />
            <ThemeToggle />
          </div>
        )}
      </div>
    </header>
  );
};

export default DashboardBar;
