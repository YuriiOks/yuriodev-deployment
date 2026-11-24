import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount, FinanceSummary } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import { totalsByCurrency } from '../../../services/dashboards/wallet';
import styles from './Money.module.css';

export interface MoneyTotalsProps {
  accounts: readonly FinanceAccount[];
  /** This month's movement per currency, when the summary has loaded (the strip is complete without it). */
  summary: FinanceSummary | null;
}

/**
 * The totals strip: one block per currency (never a sum across them) with the owner's own money in it, how much of that sits in
 * pots, and, when known, this month's spending and income. Archived accounts are not counted.
 */
const MoneyTotals: React.FC<MoneyTotalsProps> = ({ accounts, summary }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const totals = totalsByCurrency(accounts);
  if (totals.length === 0) return null;
  return (
    <ul className={styles.totals}>
      {totals.map((total) => {
        const month = summary?.currencies.find((item) => item.currency === total.currency);
        return (
          <li key={total.currency} className={styles.total}>
            <span className={styles.totalLabel}>{fill(m.totalOf, { currency: total.currency, n: total.accounts })}</span>
            <span className={styles.totalSum}>{formatMinor(total.own, total.currency, lang)}</span>
            {total.pots !== 0 && <span className={styles.totalNote}>{fill(m.inPots, { amount: formatMinor(total.pots, total.currency, lang) })}</span>}
            {month && (month.spent > 0 || month.received > 0) && (
              <span className={styles.totalNote}>
                {m.thisMonth}: {m.spent} {formatMinor(month.spent, total.currency, lang)} · {m.received} {formatMinor(month.received, total.currency, lang)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default MoneyTotals;
