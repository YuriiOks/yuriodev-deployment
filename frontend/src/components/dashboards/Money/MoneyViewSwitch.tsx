import React from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import { type MoneyView } from './moneyViews';
import styles from './Attention.module.css';

export interface MoneyViewSwitchProps {
  view: MoneyView;
  /** What needs attention now (a badge on its tab). */
  attention: number;
  /** Items snoozed or dismissed: a quiet link when nothing is active. */
  hidden: number;
}

/** The sections of the Money page as pills: Today, Wallet, Payments, Spending and Transactions. The payments list belongs to Payments. */
const MoneyViewSwitch: React.FC<MoneyViewSwitchProps> = ({ view, attention, hidden }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const td = t.money.today;
  const tabs: { id: MoneyView; to: string; label: string }[] = [
    { id: 'today', to: '?', label: td.tabs.today },
    { id: 'wallet', to: '?view=wallet', label: td.tabs.wallet },
    { id: 'payments', to: '?view=payments', label: td.tabs.payments },
    { id: 'spending', to: '?view=spending', label: td.tabs.spending },
    { id: 'transactions', to: '?view=transactions', label: td.tabs.transactions },
  ];
  const current = view === 'recurring' ? 'payments' : view;
  return (
    <nav aria-label={td.navLabel} className={styles.views}>
      <ul className={styles.tabs}>
        {tabs.map((tab) => (
          <li key={tab.id}>
            <Link className={styles.tab} to={tab.to} aria-current={current === tab.id ? 'page' : undefined}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
      {attention === 0 && hidden > 0 && view === 'today' && (
        <Link className={styles.hiddenLink} to="?view=attention">
          {fill(r.hiddenCount, { n: hidden })}
        </Link>
      )}
    </nav>
  );
};

export default MoneyViewSwitch;
