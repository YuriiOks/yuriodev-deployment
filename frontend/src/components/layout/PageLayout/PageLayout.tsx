import React, { useState, useEffect, useRef, useCallback } from 'react';
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

/** The one overlay that may be open; opening another replaces it. */
type Overlay = 'palette' | 'help' | null;

/** True for targets where a typed character belongs to the field, not to a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

interface PageLayoutProps {
  children: React.ReactNode;
  currentPath?: string;
}

const PageLayout: React.FC<PageLayoutProps> = ({ children, currentPath = '/' }) => {
  const { toggleTheme } = useTheme();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const setPaletteOpen = useCallback(
    (open: boolean) => setOverlay((current) => (open ? 'palette' : current === 'palette' ? null : current)),
    [],
  );
  const openHelp = useCallback(() => setOverlay('help'), []);
  const closeHelp = useCallback(() => setOverlay((current) => (current === 'help' ? null : current)), []);
  const mainRef = useRef<HTMLElement>(null);
  useRouteChangeFocus(mainRef);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Single-key shortcuts only: never while typing in a field, while an
      // input method is composing, or when a modifier is held (Ctrl/Cmd+K
      // belongs to the command palette, not to "previous section").
      if (isTypingTarget(e.target) || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      // Toggle help panel with '?' key
      if (e.key === '?') {
        e.preventDefault();
        setOverlay((current) => (current === 'help' ? null : 'help'));
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

  // The skip link moves focus (and the view) to main without touching the URL.
  const skipToMain = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    mainRef.current?.focus();
  };

  return (
    <>
      {/* First focusable element on every page. */}
      <a href="#main-content" className={styles.skipLink} onClick={skipToMain}>
        Skip to main content
      </a>
      <CanvasBackground />
      <CommandPalette isOpen={overlay === 'palette'} onOpenChange={setPaletteOpen} onShowHelp={openHelp} />
      <HelpPanel isOpen={overlay === 'help'} onClose={closeHelp} />
      <ScrollToTop suppressed={overlay !== null} />
      <Header onHelpToggle={openHelp} currentPath={currentPath} />
      <LeftSidebar />
      <main id="main-content" ref={mainRef} tabIndex={-1} className={styles.mainContent}>
        {children}
      </main>
      <Footer />
    </>
  );
};

export default PageLayout;
