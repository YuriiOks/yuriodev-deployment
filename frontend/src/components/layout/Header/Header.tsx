import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../../context/useTheme';
import { useSectionNav } from '../../../context/useSectionNav';
import { useOverlay } from '../../../context/useOverlay';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { minWidth } from '../../../constants/breakpoints';
import { NAV_PAGES, pageAt } from '../../../data/site';
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
  // From the sidebar breakpoint up the sidebar navigates the sections and the
  // page links sit inline, so there is no menu; below it the menu is the one
  // place to reach both.
  const wide = useMediaQuery(minWidth('sidebar'));
  const navControlsRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // The control in the header that last had focus, while focus is still
  // there; lets focus follow when that control unmounts at the breakpoint.
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const currentPage = pageAt(currentPath)?.id;
  const isMenuOpen = active === 'menu' && !wide;

  // Close the menu whenever the route changes, and when the window grows
  // past the point where the menu exists (before paint, so it never shows).
  useLayoutEffect(() => {
    close('menu');
  }, [currentPath, close]);
  useLayoutEffect(() => {
    if (wide) close('menu');
  }, [wide, close]);

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

  // Growing past the breakpoint unmounts the menu button and the section
  // links. If one of them had focus, hand it to the first page link rather
  // than letting it drop to <body>.
  useLayoutEffect(() => {
    if (!wide) return;
    const last = lastFocusRef.current;
    const active = document.activeElement;
    if (!last || last.isConnected || (active && active !== document.body)) return;
    navControlsRef.current?.querySelector<HTMLElement>('a[href]')?.focus();
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

  // Generate dynamic terminal prompt based on current page and section
  const getTerminalPrompt = () => {
    // Always show the page name (portfolio, community, courses, dashboard)
    const pageName = currentPage ?? currentPath.substring(1);
    const pageArgument = ` --page=${pageName}`;
    const themeArgument = ` --theme=${theme}`;
    return `yurii@yuriodev:~$ ./run --module=AI_Education${pageArgument}${themeArgument}`;
  };

  return (
    <header className={styles.terminalHeader} role="banner">
      <nav className={styles.terminalNav} role="navigation" aria-label="Main navigation">
        <div className={styles.terminalPrompt}>
          {getTerminalPrompt()}<span className={styles.cursor}>_</span>
        </div>
        <div className={styles.navControls} ref={navControlsRef} onFocus={onNavFocus} onBlur={onNavBlur}>
          <button
            className={styles.themeToggle}
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
            className={styles.paletteToggle}
            onClick={() => open('palette')}
            aria-label="Open command palette"
            aria-haspopup="dialog"
            aria-keyshortcuts="Control+K Meta+K"
            title="Command palette (Ctrl/Cmd + K)"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M15.5 15.5 20 20" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.helpToggle}
            onClick={() => open('help')}
            aria-label="Show help panel"
            aria-haspopup="dialog"
          >
            ?
          </button>
          {!wide && (
            <button
              ref={menuButtonRef}
              className={styles.mobileMenuToggle}
              onClick={toggleMobileMenu}
              aria-label="Toggle mobile menu"
              aria-expanded={isMenuOpen}
              aria-controls="navMenu"
            >
              ≡ MENU
            </button>
          )}
          <ul
            className={`${styles.navMenu} ${wide ? '' : styles.dropdown} ${isMenuOpen ? styles.active : ''}`}
            id="navMenu"
          >
            {/* The home page's sections: in the menu only, the sidebar lists them when wide. */}
            {!wide &&
              sections.map(({ id, navLabel }) => (
                <li key={id}>
                  <SectionLink
                    id={id}
                    current={activeId === id}
                    className={`${styles.navLink} ${activeId === id ? styles.active : ''}`}
                    onClick={closeMenu}
                  >
                    {navLabel}
                  </SectionLink>
                </li>
              ))}

            <li className={styles.navSeparator} aria-hidden="true">|</li>

            {NAV_PAGES.map(({ id, path, navLabel }) => (
              <li key={id}>
                <Link
                  to={path}
                  className={`${styles.navLink} ${currentPage === id ? styles.pageActive : ''}`}
                  aria-current={currentPage === id ? 'page' : undefined}
                  onClick={closeMenu}
                >
                  {navLabel}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </header>
  );
};

export default Header;
