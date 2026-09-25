import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '../../../context/useTheme';
import Header from '../Header/Header';
import Footer from '../Footer/Footer';
import LeftSidebar from '../LeftSidebar/LeftSidebar';
import CanvasBackground from '../../ui/CanvasBackground/CanvasBackground';
import CommandPalette from '../../ui/CommandPalette/CommandPalette';
import HelpPanel from '../../ui/HelpPanel/HelpPanel';
import ScrollToTop from '../../ui/ScrollToTop/ScrollToTop';
import { useRouteChangeFocus } from '../../../hooks/useRouteChangeFocus';
import styles from './PageLayout.module.css';
import { scrollBehavior } from '../../../utils/motion';

interface PageLayoutProps {
  children: React.ReactNode;
  currentPath?: string;
}

const PageLayout: React.FC<PageLayoutProps> = ({ children, currentPath = '/' }) => {
  const { toggleTheme } = useTheme();
  const [isHelpPanelOpen, setIsHelpPanelOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  useRouteChangeFocus(mainRef);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Toggle help panel with '?' key
      if (e.key === '?') {
        e.preventDefault();
        setIsHelpPanelOpen(prev => !prev);
        return;
      }

      // Toggle theme with 'T' key
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        toggleTheme();
        return;
      }

      // Navigate sections with J (next) and K (previous)
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        navigateSection('next');
        return;
      }

      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        navigateSection('previous');
        return;
      }

      // Scroll to top with Home key
      if (e.key === 'Home') {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: scrollBehavior() });
        return;
      }

      // Scroll to bottom with End key
      if (e.key === 'End') {
        e.preventDefault();
        window.scrollTo({ top: document.body.scrollHeight, behavior: scrollBehavior() });
        return;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [toggleTheme]);

  // Section navigation helper
  const navigateSection = (direction: 'next' | 'previous') => {
    const allSections = Array.from(document.querySelectorAll('main section[id]')) as HTMLElement[];

    if (allSections.length === 0) return;

    const scrollPosition = window.scrollY + window.innerHeight / 2;
    let currentIndex = 0;

    for (let i = 0; i < allSections.length; i++) {
      const section = allSections[i];
      const sectionTop = section.offsetTop;
      const sectionBottom = sectionTop + section.offsetHeight;

      if (scrollPosition >= sectionTop && scrollPosition < sectionBottom) {
        currentIndex = i;
        break;
      }
    }

    let targetIndex = currentIndex;
    if (direction === 'next') {
      targetIndex = Math.min(currentIndex + 1, allSections.length - 1);
    } else {
      targetIndex = Math.max(currentIndex - 1, 0);
    }

    const targetSection = allSections[targetIndex];
    if (targetSection) {
      targetSection.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    }
  };

  return (
    <>
      <CanvasBackground />
      <CommandPalette />
      <HelpPanel isOpen={isHelpPanelOpen} onClose={() => setIsHelpPanelOpen(false)} />
      <ScrollToTop />
      <Header onHelpToggle={() => setIsHelpPanelOpen(true)} currentPath={currentPath} />
      <LeftSidebar />
      <main id="main-content" ref={mainRef} tabIndex={-1} className={styles.mainContent}>
        {children}
      </main>
      <Footer />
    </>
  );
};

export default PageLayout;
