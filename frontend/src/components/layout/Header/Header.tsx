import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../../context/useTheme';
import styles from './Header.module.css';

interface HeaderProps {
  onHelpToggle?: () => void;
  currentPath?: string;
}

const Header: React.FC<HeaderProps> = ({ onHelpToggle, currentPath = '/' }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('hero');
  const { theme, toggleTheme } = useTheme();

  // Determine current page name from path
  const getCurrentPage = () => {
    const page = currentPath === '/' ? 'portfolio' : currentPath.substring(1);
    console.log('📍 Header - Current Path:', currentPath, '→ Page:', page);
    return page;
  };

  // Track active section based on scroll
  useEffect(() => {
    const sections = document.querySelectorAll('section[id]');
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

    sections.forEach((section) => observer.observe(section));
    return () => sections.forEach((section) => observer.unobserve(section));
  }, []);

  const toggleMobileMenu = () => {
    setIsMenuOpen(!isMenuOpen);
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
        <div className={styles.navControls}>
          <button className={styles.themeToggle} onClick={toggleTheme} aria-label="Toggle dark/light theme">
            {theme === 'dark' ? '☾' : '☀'}
          </button>
          <button className={styles.helpToggle} onClick={onHelpToggle} aria-label="Show help panel">?</button>
          <button className={styles.mobileMenuToggle} onClick={toggleMobileMenu} aria-label="Toggle mobile menu">≡ MENU</button>
          <ul className={`${styles.navMenu} ${isMenuOpen ? styles.active : ''}`} id="navMenu" role="menubar">
            {/* Main sections - visible on mobile only */}
            <li className={styles.mainSectionLinkLi} role="none">
              <a href="#hero" className={`${styles.navLink} ${isActive('hero') ? styles.active : ''}`} role="menuitem">--hero</a>
            </li>
            <li className={styles.mainSectionLinkLi} role="none">
              <a href="#about" className={`${styles.navLink} ${isActive('about') ? styles.active : ''}`} role="menuitem">--about</a>
            </li>
            <li className={styles.mainSectionLinkLi} role="none">
              <a href="#platform" className={`${styles.navLink} ${isActive('platform') ? styles.active : ''}`} role="menuitem">--yuriodev_vision</a>
            </li>
            <li className={styles.mainSectionLinkLi} role="none">
              <a href="#projects" className={`${styles.navLink} ${isActive('projects') ? styles.active : ''}`} role="menuitem">--projects</a>
            </li>
            <li className={styles.mainSectionLinkLi} role="none">
              <a href="#timeline" className={`${styles.navLink} ${isActive('timeline') ? styles.active : ''}`} role="menuitem">--timeline</a>
            </li>
            <li className={styles.mainSectionLinkLi} role="none">
              <a href="#skills" className={`${styles.navLink} ${isActive('skills') ? styles.active : ''}`} role="menuitem">--skills</a>
            </li>
            <li className={styles.mainSectionLinkLi} role="none">
              <a href="#terminal" className={`${styles.navLink} ${isActive('terminal') ? styles.active : ''}`} role="menuitem">--terminal</a>
            </li>
            <li className={styles.mainSectionLinkLi} role="none">
              <a href="#connect" className={`${styles.navLink} ${isActive('connect') ? styles.active : ''}`} role="menuitem">--connect</a>
            </li>
            
            {/* Separator - visible on desktop */}
            <li className={`${styles.navSeparator} ${styles.mainSectionSeparator}`} role="none">|</li>
            
            {/* Page links - visible on desktop */}
            <li role="none">
              <Link to="/" className={`${styles.navLink} ${isPageActive('portfolio') ? styles.pageActive : ''}`} role="menuitem">--portfolio</Link>
            </li>
            <li role="none">
              <Link to="/courses" className={`${styles.navLink} ${isPageActive('courses') ? styles.pageActive : ''}`} role="menuitem">--courses</Link>
            </li>
            <li role="none">
              <Link to="/dashboard" className={`${styles.navLink} ${isPageActive('dashboard') ? styles.pageActive : ''}`} role="menuitem">--dashboard</Link>
            </li>
            <li role="none">
              <Link to="/community" className={`${styles.navLink} ${isPageActive('community') ? styles.pageActive : ''}`} role="menuitem">--community</Link>
            </li>
          </ul>
        </div>
      </nav>
    </header>
  );
};

export default Header;
