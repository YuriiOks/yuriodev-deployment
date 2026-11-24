import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceSummary } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import styles from './Money.module.css';

/** This month per currency: the balance, what was spent and what was received. One block per currency, never a total across them. */
const MoneySummary: React.FC<{ summary: FinanceSummary }> = ({ summary }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  if (summary.currencies.length === 0) return <p className={styles.empty}>{m.noAccounts}</p>;
  return (
    <ul className={styles.months}>
      {summary.currencies.map((item) => (
        <li key={item.currency} className={styles.month}>
          <span className={styles.code}>
            {item.currency} · {fill(m.accountsCount, { n: item.accounts })}
          </span>
          {(
            [
              [m.balance, formatMinor(item.ownBalance, item.currency, lang)],
              [m.spent, formatMinor(item.spent, item.currency, lang)],
              [m.received, formatMinor(item.received, item.currency, lang)],
            ] as const
          ).map(([label, value]) => (
            <span key={label} className={styles.cell}>
              <span className={styles.amount}>
                {value}
              </span>
              <span className={styles.cellLabel}>{label}</span>
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
};

export default MoneySummary;
