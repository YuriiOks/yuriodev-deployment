import React, { useRef } from 'react';
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
  /** Makes the tab and panel ids unique on the page; the panel is `${idPrefix}-panel`. */
  idPrefix: string;
}

/**
 * The row of sources as an ARIA tab list: one tab stop (the selected tab), the
 * arrow keys, Home and End move between the tabs and select the one reached,
 * and the selected tab controls the panel grid beside it.
 */
const SourceTabs: React.FC<SourceTabsProps> = ({ tabs, current, counts, onSelect, idPrefix }) => {
  const { t } = useDashboardLang();
  const refs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  const move = (event: React.KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const target =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (target === null) return;
    event.preventDefault();
    onSelect(tabs[target]);
    refs.current[tabs[target]]?.focus();
  };

  return (
    <nav aria-label={t.sourcesLabel} className={styles.tabs}>
      <div role="tablist" aria-label={t.sourcesLabel} className={styles.scroller}>
        {tabs.map((tab, index) => {
          const count = counts[tab] ?? 0;
          const selected = tab === current;
          return (
            <button
              key={tab}
              ref={(el) => {
                refs.current[tab] = el;
              }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${tab}`}
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel`}
              tabIndex={selected ? 0 : -1}
              className={cx(styles.tab, selected && styles.on)}
              onClick={() => onSelect(tab)}
              onKeyDown={(event) => move(event, index)}
            >
              <DashIcon name={tab} tone={TAB_TONE[tab]} />
              <span>{t.tabs[tab]}</span>
              {count > 0 && <span className={styles.count}>{count}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default SourceTabs;
