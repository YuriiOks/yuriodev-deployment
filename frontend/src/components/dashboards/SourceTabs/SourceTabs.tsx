import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { TAB_TONE } from '../../../services/dashboards/spaces';
import type { TabId } from '../../../services/dashboards/types';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import styles from './SourceTabs.module.css';

export interface SourceTabsProps {
  tabs: readonly TabId[];
  current: TabId;
  /** The number on each tab; a tab with none (or 0) shows no number. */
  counts: Readonly<Partial<Record<TabId, number>>>;
  onSelect: (tab: TabId) => void;
}

/** The row of sources: an icon, a name and a counter each. The pressed one is the tab on screen. */
const SourceTabs: React.FC<SourceTabsProps> = ({ tabs, current, counts, onSelect }) => {
  const { t } = useDashboardLang();
  return (
    <nav aria-label={t.sourcesLabel} className={styles.tabs}>
      {tabs.map((tab) => {
        const count = counts[tab] ?? 0;
        return (
          <button
            key={tab}
            type="button"
            aria-pressed={tab === current}
            className={cx(styles.tab, tab === current && styles.on)}
            onClick={() => onSelect(tab)}
          >
            <DashIcon name={tab} tone={TAB_TONE[tab]} />
            <span>{t.tabs[tab]}</span>
            {count > 0 && <span className={styles.count}>{count}</span>}
          </button>
        );
      })}
    </nav>
  );
};

export default SourceTabs;
