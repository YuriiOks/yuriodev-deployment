import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../../context/useTheme';
import { useSectionNav } from '../../../context/useSectionNav';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { minWidth } from '../../../constants/breakpoints';
import { NAV_PAGES, pageAt } from '../../../data/site';
import SectionLink from '../SectionLink/SectionLink';
import styles from './Header.module.css';

interface HeaderProps {
  onHelpToggle?: () => void;
  currentPath?: string;
}

const Header: React.FC<HeaderProps> = ({ onHelpToggle, currentPath = '/' }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(currentPath);
  const { theme, toggleTheme } = useTheme();
  const { sections, activeId } = useSectionNav();
  // From the sidebar breakpoint up the sidebar navigates the sections and the
  // page links sit inline, so there is no menu; below it the menu is the one
  // place to reach both.
  const wide = useMediaQuery(minWidth('sidebar'));
  const navControlsRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const currentPage = pageAt(currentPath)?.id;

  // Close the menu whenever the route changes, and when the window grows
  // past the point where the menu exists.
  if (menuPath !== currentPath) {
    setMenuPath(currentPath);
    setIsMenuOpen(false);
  }
  if (wide && isMenuOpen) setIsMenuOpen(false);

  // While open, Escape or a click/tap outside the menu closes it.
  useEffect(() => {
    if (!isMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Only pull focus back when it was in the menu (or nowhere), not
        // when another overlay, such as the command palette, holds it.
        const active = document.activeElement;
        const focusInMenu = !active || active === document.body || navControlsRef.current?.contains(active);
        setIsMenuOpen(false);
        if (focusInMenu) menuButtonRef.current?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!navControlsRef.current?.contains(e.target as Node)) setIsMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isMenuOpen]);

  const closeMenu = () => setIsMenuOpen(false);

  const toggleMobileMenu = () => {
    setIsMenuOpen((open) => !open);
  };

  // Generate dynamic terminal prompt based on current page and section
  const getTerminalPrompt = () => {
    // Always show the page name (portfolio, community, courses, dashboard)
    const pageName = currentPath === '/' ? 'portfolio' : currentPath.substring(1);
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
        <div className={styles.navControls} ref={navControlsRef}>
          <button
            className={styles.themeToggle}
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
          </button>
          <button className={styles.helpToggle} onClick={onHelpToggle} aria-label="Show help panel">?</button>
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
