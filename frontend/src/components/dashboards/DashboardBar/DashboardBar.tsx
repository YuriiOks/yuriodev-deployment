import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { pagePath, projectPath, type PageId } from '../../../data/site';
import { useBarData } from '../../../hooks/useBarData';
import { useSpaceNames } from '../../../hooks/useSpaceNames';
import { promptPlace } from '../../../services/dashboards/promptPlace';
import { SPACES, SPACE_PAGE } from '../../../services/dashboards/spaces';
import { cx } from '../../../utils/cx';
import header from '../../layout/Header/Header.module.css';
import ProjectIcon from '../ProjectIcon/ProjectIcon';
import ProjectTile from '../ProjectTile/ProjectTile';
import SpaceTile from '../SpaceTile/SpaceTile';
import LangSwitch from '../LangSwitch/LangSwitch';
import ThemeToggle from '../ThemeToggle/ThemeToggle';
import styles from './DashboardBar.module.css';

/** A pill's mark: a 24px box holding the tile, or a drawn line icon centred in it (decorative: the name beside it says it). */
const Mark: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span aria-hidden="true" className={styles.mark}>
    {children}
  </span>
);

/** The quiet blocks the pills' place holds until the answer (or the last visit's cache) says what the pills are. */
const SKELETON = ['all', 'personal', 'work-1', 'work-2', 'calendar'] as const;

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
  // The pills come from useBarData: the bootstrap answer already lists the projects, so the bar asks for nothing of its own.
  const { phase, projects: active, stale } = useBarData();
  const currentRef = useRef<HTMLAnchorElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  const { pathname } = useLocation();
  const place = promptPlace(pathname, {
    spaceName: serverNameOf,
    projectName: (id) => active.find((project) => project.id === id)?.name,
  });
  // When the row is wider than its room, its right end fades out (a hint that it scrolls): measured after paint, on a resize, on a scroll and
  // whenever the pills change.
  useEffect(() => {
    const measure = () => {
      const nav = navRef.current;
      if (nav) setMore(nav.scrollWidth - nav.clientWidth > 1 && nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
    };
    const frame = window.requestAnimationFrame(measure);
    const nav = navRef.current;
    window.addEventListener('resize', measure);
    nav?.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      nav?.removeEventListener('scroll', measure);
    };
  }, [active.length, phase, phone, pathname]);
  // The current pill stays in view when the row scrolls sideways (many projects, a phone).
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [pathname, active.length]);
  const marks: Record<string, React.ReactNode> = {
    dashboards: <ProjectIcon name="grid" size={20} />,
    'dashboards-calendar': <ProjectIcon name="calendar" size={20} />,
  };
  const before: ReadonlyArray<readonly [PageId, string, React.ReactNode]> = [['dashboards', t.navAll, marks.dashboards]];
  const spaces = SPACES.map((id) => [SPACE_PAGE[id], nameOf(id), <SpaceTile space={id} />] as const);
  const after: ReadonlyArray<readonly [PageId, string, React.ReactNode]> = [['dashboards-calendar', t.navCalendar, marks['dashboards-calendar']]];
  const items = [...before, ...spaces, ...after];

  return (
    <div className={styles.bar} data-stale={stale ? 'true' : undefined}>
      <div className={styles.inner}>
        <div className={cx(header.terminalPrompt, styles.prompt)}>
          <span className={cx(header.promptFull, styles.full)}>yurii@yuriodev:~$ ./{place}</span>
          <span className={cx(header.promptShort, styles.short)}>~$ ./{place.split('/').pop()}</span>
          <span className={header.cursor} aria-hidden="true">
            _
          </span>
        </div>
        <nav ref={navRef} aria-label={t.navLabel} className={styles.nav} data-more={more ? 'true' : undefined} aria-busy={phase === 'placeholder' ? true : undefined}>
          {phase === 'placeholder' && SKELETON.map((key) => <span key={key} aria-hidden="true" data-skeleton="true" className={styles.skeleton} />)}
          {phase !== 'placeholder' && phase !== 'unreachable' && items.map(([id, label, mark]) => (
            <NavLink key={id} to={pagePath(id)} end={id === 'dashboards'} className={navClass}>
              <Mark>{mark}</Mark>
              {label}
            </NavLink>
          ))}
          {phase !== 'placeholder' && phase !== 'unreachable' && active.length > 0 && <span role="separator" aria-orientation="vertical" aria-label={t.navProjects} className={styles.divider} />}
          {phase !== 'placeholder' && phase !== 'unreachable' && active.map((project) => (
            <NavLink key={project.id} to={projectPath(project.id)} end className={navClass} ref={pathname === projectPath(project.id) ? currentRef : undefined}>
              <Mark>
                <ProjectTile name={project.name} icon={project.icon} />
              </Mark>
              {project.name}
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
