import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../../context/useTheme';
import { useSectionNav } from '../../../context/useSectionNav';
import { useOverlay } from '../../../context/useOverlay';
import { subscribeMediaQuery, useMediaQuery } from '../../../hooks/useMediaQuery';
import { minWidth } from '../../../constants/breakpoints';
import { NAV_PAGES, navPages, pageAt } from '../../../data/site';
import { cx } from '../../../utils/cx';
import MoreMenu from './MoreMenu';
import SectionLink from '../SectionLink/SectionLink';
import styles from './Header.module.css';

interface HeaderProps {
  currentPath?: string;
}

const Header: React.FC<HeaderProps> = ({ currentPath = '/' }) => {
  const { theme, toggleTheme } = useTheme();
  // The menu is one of the page's overlays: opening the palette or the help
  // panel closes it, and opening it closes them.
  const { active, open, close, toggle } = useOverlay();
  const { sections, activeId } = useSectionNav();
  // From the sidebar breakpoint up the section rail navigates the sections
  // and the pages sit in the header (the main one inline, the rest in the
  // More menu), so there is no menu button; below it the menu is the one
  // place to reach both.
  const wide = useMediaQuery(minWidth('sidebar'));
  const navControlsRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // The control in the header that last had focus, while focus is still
  // there; lets focus follow when that control unmounts at the breakpoint.
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const currentPage = pageAt(currentPath)?.id;
  const isMenuOpen = active === 'menu' && !wide;

  // Each menu is hidden (isMenuOpen, MoreMenu unmounted) from the moment the
  // window crosses the point where it stops existing; closing it on that
  // change keeps it from coming back when the window crosses back. A route
  // change closes both in OverlayProvider, which keys them to the route they
  // were opened on.
  useEffect(
    () =>
      subscribeMediaQuery(minWidth('sidebar'), (matches) => {
        close(matches ? 'menu' : 'more');
      }),
    [close],
  );

  // While open, Escape or a click/tap outside the menu closes it.
  useEffect(() => {
    if (!isMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Only pull focus back when it was in the menu (or nowhere), not
        // when something else on the page holds it.
        const focused = document.activeElement;
        const focusInMenu = !focused || focused === document.body || navControlsRef.current?.contains(focused);
        close('menu');
        if (focusInMenu) menuButtonRef.current?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!navControlsRef.current?.contains(e.target as Node)) close('menu');
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isMenuOpen, close]);

  // Crossing the breakpoint unmounts the controls of the other layout (the
  // menu button and the section links going wide, the More menu going
  // narrow). If one of them had focus, hand it to the first page link, or
  // to the menu button, rather than letting it drop to <body>.
  useLayoutEffect(() => {
    const last = lastFocusRef.current;
    const active = document.activeElement;
    if (!last || last.isConnected || (active && active !== document.body)) return;
    if (wide) navControlsRef.current?.querySelector<HTMLElement>('a[href]')?.focus();
    else menuButtonRef.current?.focus();
  }, [wide]);

  // Tabbing out of the header closes the menu, so it never hides the
  // element that receives focus next.
  const onNavFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    lastFocusRef.current = e.target;
  };
  const onNavBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && !navControlsRef.current?.contains(next)) {
      lastFocusRef.current = null;
      close('menu');
      return;
    }
    if (!next) {
      // Focus went nowhere: a click on the page, or the window losing focus.
      // Forget the control unless it left because it was unmounted.
      const target = e.target;
      queueMicrotask(() => {
        if (lastFocusRef.current === target && target.isConnected) lastFocusRef.current = null;
      });
    }
  };

  const closeMenu = () => close('menu');
  const toggleMobileMenu = () => toggle('menu');

  // The prompt runs the current page: './portfolio', './privacy'.
  const pageName = currentPage ?? (currentPath.replace(/^\/+|\/+$/g, '') || 'portfolio');

  return (
    <header className={styles.terminalHeader} role="banner">
      <nav className={styles.terminalNav} role="navigation" aria-label="Main navigation">
        <div className={styles.terminalPrompt}>
          <span className={styles.promptFull}>yurii@yuriodev:~$ ./{pageName}</span>
          <span className={styles.promptShort}>~$ yuriodev</span>
          <span className={styles.cursor} aria-hidden="true">_</span>
        </div>
        <div className={styles.navControls} ref={navControlsRef} onFocus={onNavFocus} onBlur={onNavBlur}>
          <button
            type="button"
            className={cx(styles.navControl, styles.iconButton)}
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
          </button>
          {/* The palette's visible trigger, for touch screens and anyone
              who does not know Ctrl/Cmd+K. */}
          <button
            type="button"
            className={cx(styles.navControl, styles.iconButton)}
            onClick={() => open('palette')}
            data-opens="palette"
            aria-label="Open command palette"
            aria-haspopup="dialog"
            aria-keyshortcuts="Control+K Meta+K"
            title="Command palette (Ctrl/Cmd + K)"
          >
            <svg className={styles.searchIcon} aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M15.5 15.5 20 20" />
            </svg>
          </button>
          <button
            type="button"
            className={cx(styles.navControl, styles.iconButton, styles.helpToggle)}
            onClick={() => open('help')}
            data-opens="help"
            aria-label="Show help panel"
            aria-haspopup="dialog"
          >
            ?
          </button>
          {!wide && (
            <button
              ref={menuButtonRef}
              type="button"
              className={cx(styles.navControl, styles.menuButton)}
              onClick={toggleMobileMenu}
              data-opens="menu"
              aria-label="Toggle mobile menu"
              aria-expanded={isMenuOpen}
              aria-controls="navMenu"
            >
              ≡ MENU
            </button>
          )}
          <ul
            className={cx(styles.navMenu, !wide && styles.dropdown, isMenuOpen && styles.active)}
            id="navMenu"
          >
            {/* The home page's sections: in the menu only, the section rail lists them when wide. */}
            {!wide &&
              sections.map(({ id, navLabel }) => (
                <li key={id}>
                  <SectionLink
                    id={id}
                    current={activeId === id}
                    className={cx(styles.navLink, activeId === id && styles.current)}
                    onClick={closeMenu}
                  >
                    {navLabel}
                  </SectionLink>
                </li>
              ))}

            <li className={styles.navSeparator} aria-hidden="true">|</li>

            {/* Narrow: every page in the menu. Wide: the main page inline, the rest under More. */}
            {(wide ? navPages('primary') : NAV_PAGES).map(({ id, path, navLabel }) => (
              <li key={id}>
                <Link
                  to={path}
                  className={cx(styles.navLink, currentPage === id && styles.current)}
                  aria-current={currentPage === id ? 'page' : undefined}
                  onClick={closeMenu}
                >
                  {navLabel}
                </Link>
              </li>
            ))}
            {wide && <MoreMenu pages={navPages('more')} currentPage={currentPage} />}
          </ul>
        </div>
      </nav>
    </header>
  );
};

export default Header;
