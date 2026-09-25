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
      <OverlayProvider routeKey={currentPath}>
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
  // When the element that opened a dialog cannot take focus back (a link in
  // the header menu, which opening the dialog closed), focus goes to the
  // header control that opens that dialog, else the menu button.
  const paletteReturn = useCallback(() => [headerControl('palette'), headerControl('menu')], []);
  const helpReturn = useCallback(
    () => [headerControl('help'), headerControl('menu'), headerControl('palette')],
    [],
  );
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
      <CommandPalette
        open={active === 'palette'}
        onClose={closePalette}
        onShowHelp={openHelp}
        returnFocus={paletteReturn}
      />
      <HelpPanel open={active === 'help'} onClose={closeHelp} returnFocus={helpReturn} />
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

/** The header button that opens an overlay (Header marks them with data-opens). */
function headerControl(id: 'palette' | 'help' | 'menu'): HTMLElement | null {
  return document.querySelector<HTMLElement>(`header [data-opens="${id}"]`);
}

export default PageLayout;
