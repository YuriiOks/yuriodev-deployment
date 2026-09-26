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
import { SectionNavProvider } from '../../../context/SectionNavProvider';
import { useSectionNav } from '../../../context/useSectionNav';
import { shortcutFor } from '../../../data/site';
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
  const mainRef = useRef<HTMLElement>(null);
  return (
    <SectionNavProvider mainRef={mainRef}>
      <PageLayoutContent mainRef={mainRef} currentPath={currentPath}>
        {children}
      </PageLayoutContent>
    </SectionNavProvider>
  );
};

interface PageLayoutContentProps extends PageLayoutProps {
  mainRef: React.RefObject<HTMLElement | null>;
}

const PageLayoutContent: React.FC<PageLayoutContentProps> = ({ children, currentPath = '/', mainRef }) => {
  const { toggleTheme } = useTheme();
  const { step } = useSectionNav();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const setPaletteOpen = useCallback(
    (open: boolean) => setOverlay((current) => (open ? 'palette' : current === 'palette' ? null : current)),
    [],
  );
  const openHelp = useCallback(() => setOverlay('help'), []);
  const closeHelp = useCallback(() => setOverlay((current) => (current === 'help' ? null : current)), []);
  useRouteChangeFocus(mainRef);

  // Single-key shortcuts (the list lives in data/site.ts). Never while typing
  // in a field or while an input method is composing; shortcutFor ignores
  // keys pressed with a modifier, so Ctrl/Cmd+K stays the palette's.
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.isComposing) return;

      switch (shortcutFor(e)) {
        case 'help':
          e.preventDefault();
          setOverlay((current) => (current === 'help' ? null : 'help'));
          break;
        case 'theme':
          e.preventDefault();
          toggleTheme();
          break;
        case 'next':
          e.preventDefault();
          step(1);
          break;
        case 'prev':
          e.preventDefault();
          step(-1);
          break;
        case 'top':
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: scrollBehavior() });
          break;
        case 'bottom':
          e.preventDefault();
          window.scrollTo({ top: document.body.scrollHeight, behavior: scrollBehavior() });
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [toggleTheme, step]);

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
