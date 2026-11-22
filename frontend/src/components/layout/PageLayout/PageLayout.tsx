import React, { useCallback, useMemo, useRef } from 'react';
import Header from '../Header/Header';
import Footer from '../Footer/Footer';
import SectionRail from '../SectionRail/SectionRail';
import CanvasBackground from '../../ui/CanvasBackground/CanvasBackground';
import CommandPalette from '../../ui/CommandPalette/CommandPalette';
import HelpPanel from '../../ui/HelpPanel/HelpPanel';
import ScrollToTop from '../../ui/ScrollToTop/ScrollToTop';
import { PAGE_CONTENT_ID } from '../../../constants/pageContent';
import { chromeAllowedAt } from '../../../data/site';
import { useRouteChangeFocus } from '../../../hooks/useRouteChangeFocus';
import { useGlobalShortcuts } from '../../../hooks/useGlobalShortcuts';
import { SectionNavProvider } from '../../../context/SectionNavProvider';
import { OverlayProvider } from '../../../context/OverlayProvider';
import { ToastProvider } from '../../../context/ToastProvider';
import { useOverlay } from '../../../context/useOverlay';
import type { OverlayId } from '../../../context/overlay-context';
import styles from './PageLayout.module.css';

interface PageLayoutProps {
  children: React.ReactNode;
  currentPath?: string;
}

/**
 * The page frame. A page defined with `chrome: false` (data/site.ts: the
 * private dashboards) gets none of the site's chrome: no header, footer,
 * section rail, dot canvas, scroll-to-top button, command palette or help
 * panel - only the skip link and the <main> landmark; the page brings its own
 * bar. Every other page gets the full frame.
 */
const PageLayout: React.FC<PageLayoutProps> = ({ children, currentPath = '/' }) => {
  const mainRef = useRef<HTMLElement>(null);
  return (
    <SectionNavProvider mainRef={mainRef}>
      <OverlayProvider routeKey={currentPath}>
        <ToastProvider>
          {chromeAllowedAt(currentPath) ? (
            <PageLayoutContent mainRef={mainRef} currentPath={currentPath}>
              {children}
            </PageLayoutContent>
          ) : (
            <BareLayoutContent mainRef={mainRef}>{children}</BareLayoutContent>
          )}
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
  // the header menu or the More menu, which opening the dialog closed),
  // focus goes to the header control that opens that dialog, else the
  // button of the menu it was in.
  const paletteReturn = useCallback(
    () => [headerControl('palette'), headerControl('menu'), headerControl('more')],
    [],
  );
  const helpReturn = useCallback(
    () => [headerControl('help'), headerControl('menu'), headerControl('more'), headerControl('palette')],
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
      <SectionRail />
      <main id="main-content" ref={mainRef} tabIndex={-1} className={styles.mainContent}>
        {children}
      </main>
      <Footer />
    </>
  );
};

/** The frame of a page with no site chrome: the skip link and main. */
const BareLayoutContent: React.FC<{ children: React.ReactNode; mainRef: React.RefObject<HTMLElement | null> }> = ({
  children,
  mainRef,
}) => {
  // After a navigation, and for the skip link, focus goes to the page's content area below its bar.
  const target = useMemo<React.RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return document.getElementById(PAGE_CONTENT_ID) ?? mainRef.current;
      },
    }),
    [mainRef],
  );
  useRouteChangeFocus(target);
  const skipToMain = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    target.current?.focus();
  };
  return (
    <>
      <a href="#main-content" className={styles.skipLink} onClick={skipToMain}>
        Skip to main content
      </a>
      <main id="main-content" ref={mainRef} tabIndex={-1} className={styles.bareContent}>
        {children}
      </main>
    </>
  );
};

/** The header button that opens an overlay (Header marks them with data-opens). */
function headerControl(id: OverlayId): HTMLElement | null {
  return document.querySelector<HTMLElement>(`header [data-opens="${id}"]`);
}

export default PageLayout;
