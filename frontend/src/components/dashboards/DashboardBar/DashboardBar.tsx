import React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { pagePath, type PageId } from '../../../data/site';
import { useDashboardMode } from '../../../hooks/useDashboardMode';
import { useSpaceNames } from '../../../hooks/useSpaceNames';
import { promptPlace } from '../../../services/dashboards/promptPlace';
import { SPACES, SPACE_PAGE } from '../../../services/dashboards/spaces';
import { cx } from '../../../utils/cx';
import header from '../../layout/Header/Header.module.css';
import LangSwitch from '../LangSwitch/LangSwitch';
import ThemeToggle from '../ThemeToggle/ThemeToggle';
import styles from './DashboardBar.module.css';

const navClass = ({ isActive }: { isActive: boolean }) => cx(header.navLink, isActive && header.current);

export interface DashboardBarProps {
  /** A phone: the bar is the short prompt and the pages (the shell puts the two switches at the page's end). */
  phone?: boolean;
}

/**
 * The dashboards' only chrome (the site's header is not on these pages): the site's own header, built from its parts
 * (Header.module.css: the terminal prompt with its blinking cursor, the 40px bordered controls, the underlined current
 * page, the same tokens), sticky at the top. The prompt runs the current place ("./dashboards/personal"; a server's name for
 * a space or a project appears there), the dashboards pages are the nav, the portfolio
 * is one link away, and RU/EN and the theme button are the site's controls. On a phone the prompt is short and the
 * pages scroll sideways.
 */
const DashboardBar: React.FC<DashboardBarProps> = ({ phone = false }) => {
  const { t } = useDashboardLang();
  const { nameOf, serverNameOf } = useSpaceNames();
  const { projects } = useDashboardMode();
  const { pathname } = useLocation();
  const place = promptPlace(pathname, {
    spaceName: serverNameOf,
    projectName: (id) => projects.find((project) => project.id === id)?.name,
  });
  const items: ReadonlyArray<readonly [PageId, string]> = [
    ['dashboards', t.navAll],
    ...SPACES.map((id) => [SPACE_PAGE[id], nameOf(id)] as const),
    ['dashboards-calendar', t.navCalendar],
  ];

  return (
    <div className={styles.bar}>
      <div className={styles.inner}>
        <div className={cx(header.terminalPrompt, styles.prompt)}>
          <span className={header.promptFull}>yurii@yuriodev:~$ ./{place}</span>
          <span className={header.promptShort}>~$ ./{place.split('/').pop()}</span>
          <span className={header.cursor} aria-hidden="true">
            _
          </span>
        </div>
        <nav aria-label={t.navLabel} className={styles.nav}>
          {items.map(([id, label]) => (
            <NavLink key={id} to={pagePath(id)} end className={navClass}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.tools}>
          <Link to="/" className={header.navLink} aria-label={t.backToSite}>
            <span aria-hidden="true">←</span>
            <span className={styles.portfolioText}>{t.toPortfolio}</span>
          </Link>
          {!phone && (
            <>
              <LangSwitch />
              <ThemeToggle />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardBar;
