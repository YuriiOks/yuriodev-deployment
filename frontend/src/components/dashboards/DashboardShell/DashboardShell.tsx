import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { DashboardLangProvider } from '../../../context/DashboardLangProvider';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { PAGE_CONTENT_ID } from '../../../constants/pageContent';
import { spaceAt } from '../../../services/dashboards/spaces';
import DashboardBar from '../DashboardBar/DashboardBar';
import styles from './DashboardShell.module.css';

const Frame: React.FC = () => {
  const { lang } = useDashboardLang();
  const space = spaceAt(useLocation().pathname);
  return (
    <div className={styles.root} data-space={space} lang={lang}>
      {/* A private area: React hoists this into <head> and removes it again on unmount. */}
      <meta name="robots" content="noindex" />
      <div className={styles.inner}>
        <DashboardBar />
        {/* The skip link and the focus after a navigation come here, below the bar. */}
        <div id={PAGE_CONTENT_ID} tabIndex={-1} className={styles.content}>
          <Outlet />
        </div>
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
