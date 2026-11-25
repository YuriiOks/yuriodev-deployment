import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import { grandTotal, shownTotals, unconvertedCurrencies } from '../../../services/dashboards/display';
import type { FinanceAccount, FinanceSummary } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import HeroAmount from './HeroAmount';
import { freshLabel } from './labels';
import styles from './Money.module.css';

export interface MoneyTotalsProps {
  accounts: readonly FinanceAccount[];
  /** This month's movement per currency, when the summary has loaded (the strip is complete without it). */
  summary: FinanceSummary | null;
  mode: MoneyDisplay;
}

/**
 * The totals strip. In pounds mode, when the server converted anything: one grand total in the display currency (marked "≈", the
 * rate's date once beside it, any currency with no rate named), and the per-currency parts under it. Otherwise one block per
 * currency (never a sum across currencies) with the owner's own money, the part in pots and this month's movement.
 */
const MoneyTotals: React.FC<MoneyTotalsProps> = ({ accounts, summary, mode }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const natives = shownTotals(accounts, 'native');
  if (natives.length === 0) return null;
  const grand = mode === 'base' ? grandTotal(accounts, summary) : null;
  const rate = summary?.rateAsOf ? freshLabel(summary.rateAsOf, lang) : '';
  // A rate more than a day old is said louder: the figures built on it may have moved.
  const rateOld = summary?.rateAsOf ? Date.now() - Date.parse(summary.rateAsOf) > 24 * 60 * 60 * 1000 : false;
  const missing = grand ? (summary?.display?.missing ?? unconvertedCurrencies(accounts)) : [];
  const counts = new Map<string, number>();
  for (const account of accounts) if (!account.archived) counts.set(account.currency, (counts.get(account.currency) ?? 0) + 1);

  return (
    <div className={styles.totalsBox}>
      {grand && (
        <div className={styles.grand}>
          <span className={styles.totalLabel}>{m.grandTotal}</span>
          <span className={styles.totalSum}>
            <HeroAmount amount={grand.amount} currency={grand.currency} approx={grand.approx} />
          </span>
          {rate && <span className={styles.totalNote} data-old={rateOld ? 'true' : undefined}>{fill(m.rateAsOf, { when: rate })}</span>}
          {missing.length > 0 && <span className={styles.totalNote}>{fill(m.notConverted, { list: missing.join(', ') })}</span>}
        </div>
      )}
      <ul className={styles.totals}>
        {natives.map((total) => {
          const month = summary?.currencies.find((item) => item.currency === total.currency);
          return (
            <li key={total.currency} className={styles.total}>
              <span className={styles.totalLabel}>{fill(m.totalOf, { currency: total.currency, n: counts.get(total.currency) ?? 0 })}</span>
              <span className={styles.totalSum}>{formatMinor(total.amount, total.currency, lang)}</span>
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
    </div>
  );
};

export default MoneyTotals;
