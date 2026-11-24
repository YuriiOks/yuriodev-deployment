import React from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import styles from './Attention.module.css';

export type MoneyView = 'overview' | 'attention' | 'recurring';

export interface MoneyViewSwitchProps {
  view: MoneyView;
  /** What needs attention now (a badge on its tab). */
  attention: number;
  /** Items snoozed or dismissed: a quiet link when nothing is active. */
  hidden: number;
}

/** The sections of the Money page as a tab-like switch: Overview, Attention (with its count) and Recurring payments. */
const MoneyViewSwitch: React.FC<MoneyViewSwitchProps> = ({ view, attention, hidden }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const tabs: { id: MoneyView; to: string; label: string; count?: number }[] = [
    { id: 'overview', to: '?', label: r.viewOverview },
    { id: 'attention', to: '?view=attention', label: r.viewAttention, count: attention },
    { id: 'recurring', to: '?view=recurring', label: r.viewRecurring },
  ];
  return (
    <nav aria-label={r.viewsLabel} className={styles.views}>
      <ul className={styles.tabs}>
        {tabs.map((tab) => (
          <li key={tab.id}>
            <Link className={styles.tab} to={tab.to} aria-current={view === tab.id ? 'page' : undefined}>
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && <span className={styles.tabCount}>{tab.count}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {attention === 0 && hidden > 0 && view === 'overview' && (
        <Link className={styles.hiddenLink} to="?view=attention">
          {fill(r.hiddenCount, { n: hidden })}
        </Link>
      )}
    </nav>
  );
};

export default MoneyViewSwitch;
