import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { DashboardLangProvider } from '../../../context/DashboardLangProvider';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { PAGE_CONTENT_ID } from '../../../constants/pageContent';
import { maxWidth } from '../../../constants/breakpoints';
import { isProjectPath } from '../../../data/site';
import { useDashboardMode } from '../../../hooks/useDashboardMode';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { spaceAt } from '../../../services/dashboards/spaces';
import DashboardBar from '../DashboardBar/DashboardBar';
import LoadingBlock from '../LoadingBlock/LoadingBlock';
import ServerUnreachable from '../ServerUnreachable/ServerUnreachable';
import { useBarData } from '../../../hooks/useBarData';
import LangSwitch from '../LangSwitch/LangSwitch';
import ThemeToggle from '../ThemeToggle/ThemeToggle';
import styles from './DashboardShell.module.css';

const Frame: React.FC = () => {
  const { lang, t } = useDashboardLang();
  const { pathname } = useLocation();
  // A project page has one skin for every project (Anthropic's clay on warm ivory or near-black), the spaces one each.
  const space = spaceAt(pathname) ?? (isProjectPath(pathname) ? 'project' : undefined);
  const phone = useMediaQuery(maxWidth('md'));
  // Which data the dashboards run on is asked once; until the answer is in, a quiet placeholder holds the place
  // (the page never flashes sample data and then swaps to real data).
  const { mode } = useDashboardMode();
  const { stale } = useBarData();
  return (
    <div className={styles.root} data-space={space} lang={lang}>
      {/* A private area: React hoists this into <head> and removes it again on unmount. */}
      <meta name="robots" content="noindex" />
      <DashboardBar phone={phone} />
      <div className={styles.inner}>
        {/* The skip link and the focus after a navigation come here, below the bar. */}
        <div id={PAGE_CONTENT_ID} tabIndex={-1} className={styles.content}>
          {mode === 'sample' && (
            <p role="note" className={styles.demo}>
              {t.sampleBanner}
            </p>
          )}
          {mode === 'loading' ? <LoadingBlock rows={4} /> : mode === 'unreachable' ? <ServerUnreachable kept={stale === true} /> : <Outlet />}
        </div>
        {/* On a phone the bar is only the pages: the two switches live down here instead. */}
        {phone && (
          <div className={styles.switches}>
            <LangSwitch />
            <ThemeToggle />
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * The layout route of every /dashboards page: the language context, the
 * space's palette (data-space remaps the --dash-* tokens) and the bar.
 * The page itself comes through the Outlet.
 */
const DashboardShell: React.FC = () => (
  <DashboardLangProvider>
    <Frame />
  </DashboardLangProvider>
);

export default DashboardShell;
