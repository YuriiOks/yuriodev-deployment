import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../../context/useTheme';
import styles from './Header.module.css';

interface HeaderProps {
  onHelpToggle?: () => void;
  currentPath?: string;
}

// Home-page sections listed in the mobile menu. '#terminal' is the
// interactive terminal inside the Connect section.
const SECTION_LINKS = [
  { id: 'hero', label: '--hero' },
  { id: 'about', label: '--about' },
  { id: 'platform', label: '--yuriodev_vision' },
  { id: 'projects', label: '--projects' },
  { id: 'timeline', label: '--timeline' },
  { id: 'skills', label: '--skills' },
  { id: 'terminal', label: '--terminal' },
  { id: 'connect', label: '--connect' },
];

const Header: React.FC<HeaderProps> = ({ onHelpToggle, currentPath = '/' }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(currentPath);
  const [activeSection, setActiveSection] = useState('hero');
  const { theme, toggleTheme } = useTheme();
  const navControlsRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const onHome = currentPath === '/';

  // Close the menu whenever the route changes.
  if (menuPath !== currentPath) {
    setMenuPath(currentPath);
    setIsMenuOpen(false);
  }

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

  // Determine current page name from path
  const getCurrentPage = () => (currentPath === '/' ? 'portfolio' : currentPath.substring(1));

  // Track active section based on scroll. Re-run on every route change so the
  // sections of the page just navigated to are observed; wait a frame for
  // them to be laid out.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: '-50% 0px -50% 0px' }
    );
    const frame = requestAnimationFrame(() => {
      document.querySelectorAll('section[id]').forEach((section) => observer.observe(section));
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [currentPath]);

  const toggleMobileMenu = () => {
    setIsMenuOpen((open) => !open);
  };

  // Generate dynamic terminal prompt based on current page and section
  const getTerminalPrompt = () => {
    const currentPage = getCurrentPage();
    // Always show the page name (portfolio, community, courses, dashboard)
    const pageArgument = ` --page=${currentPage}`;
    const themeArgument = ` --theme=${theme}`;
    return `yurii@yuriodev:~$ ./run --module=AI_Education${pageArgument}${themeArgument}`;
  };

  const isPageActive = (pageName: string) => getCurrentPage() === pageName;

  const isActive = (section: string) => activeSection === section;

  return (
    <header className={styles.terminalHeader} role="banner">
      <nav className={styles.terminalNav} role="navigation" aria-label="Main navigation">
        <div className={styles.terminalPrompt}>
          {getTerminalPrompt()}<span className={styles.cursor}>_</span>
        </div>
        <div className={styles.navControls} ref={navControlsRef}>
          <button className={styles.themeToggle} onClick={toggleTheme} aria-label="Toggle dark/light theme">
            {theme === 'dark' ? '☾' : '☀'}
          </button>
          <button className={styles.helpToggle} onClick={onHelpToggle} aria-label="Show help panel">?</button>
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
          <ul className={`${styles.navMenu} ${isMenuOpen ? styles.active : ''}`} id="navMenu">
            {/* Main sections - visible on mobile only */}
            {SECTION_LINKS.map(({ id, label }) => (
              <li key={id} className={styles.mainSectionLinkLi}>
                {onHome ? (
                  <a href={`#${id}`} className={`${styles.navLink} ${isActive(id) ? styles.active : ''}`} onClick={closeMenu}>{label}</a>
                ) : (
                  <Link to={`/#${id}`} className={styles.navLink} onClick={closeMenu}>{label}</Link>
                )}
              </li>
            ))}

            {/* Separator - visible on desktop */}
            <li className={`${styles.navSeparator} ${styles.mainSectionSeparator}`} aria-hidden="true">|</li>
            
            {/* Page links - visible on desktop */}
            <li>
              <Link to="/" className={`${styles.navLink} ${isPageActive('portfolio') ? styles.pageActive : ''}`} onClick={closeMenu}>--portfolio</Link>
            </li>
            <li>
              <Link to="/courses" className={`${styles.navLink} ${isPageActive('courses') ? styles.pageActive : ''}`} onClick={closeMenu}>--courses</Link>
            </li>
            <li>
              <Link to="/dashboard" className={`${styles.navLink} ${isPageActive('dashboard') ? styles.pageActive : ''}`} onClick={closeMenu}>--dashboard</Link>
            </li>
            <li>
              <Link to="/community" className={`${styles.navLink} ${isPageActive('community') ? styles.pageActive : ''}`} onClick={closeMenu}>--community</Link>
            </li>
          </ul>
        </div>
      </nav>
    </header>
  );
};

export default Header;
