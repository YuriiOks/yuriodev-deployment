import React, { useCallback, useRef } from 'react';
import Header from '../Header/Header';
import Footer from '../Footer/Footer';
import LeftSidebar from '../LeftSidebar/LeftSidebar';
import CanvasBackground from '../../ui/CanvasBackground/CanvasBackground';
import CommandPalette from '../../ui/CommandPalette/CommandPalette';
import HelpPanel from '../../ui/HelpPanel/HelpPanel';
import ScrollToTop from '../../ui/ScrollToTop/ScrollToTop';
import { useRouteChangeFocus } from '../../../hooks/useRouteChangeFocus';
import { useGlobalShortcuts } from '../../../hooks/useGlobalShortcuts';
import { SectionNavProvider } from '../../../context/SectionNavProvider';
import { OverlayProvider } from '../../../context/OverlayProvider';
import { ToastProvider } from '../../../context/ToastProvider';
import { useOverlay } from '../../../context/useOverlay';
import styles from './PageLayout.module.css';

interface PageLayoutProps {
  children: React.ReactNode;
  currentPath?: string;
}

const PageLayout: React.FC<PageLayoutProps> = ({ children, currentPath = '/' }) => {
  const mainRef = useRef<HTMLElement>(null);
  return (
    <SectionNavProvider mainRef={mainRef}>
      <OverlayProvider>
        <ToastProvider>
          <PageLayoutContent mainRef={mainRef} currentPath={currentPath}>
            {children}
          </PageLayoutContent>
        </ToastProvider>
      </OverlayProvider>
    </SectionNavProvider>
  );
};

interface PageLayoutContentProps extends PageLayoutProps {
  mainRef: React.RefObject<HTMLElement | null>;
}

const PageLayoutContent: React.FC<PageLayoutContentProps> = ({ children, currentPath = '/', mainRef }) => {
  const { active, open, close } = useOverlay();
  const closePalette = useCallback(() => close('palette'), [close]);
  const closeHelp = useCallback(() => close('help'), [close]);
  const openHelp = useCallback(() => open('help'), [open]);
  const dialogOpen = active === 'palette' || active === 'help';
  useRouteChangeFocus(mainRef);
  useGlobalShortcuts();

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
      <CommandPalette open={active === 'palette'} onClose={closePalette} onShowHelp={openHelp} />
      <HelpPanel open={active === 'help'} onClose={closeHelp} />
      <ScrollToTop suppressed={dialogOpen} />
      <Header currentPath={currentPath} />
      <LeftSidebar />
      <main id="main-content" ref={mainRef} tabIndex={-1} className={styles.mainContent}>
        {children}
      </main>
      <Footer />
    </>
  );
};

export default PageLayout;
