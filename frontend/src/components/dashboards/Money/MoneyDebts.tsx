import React, { useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import { formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import type { Recurring } from '../../../services/dashboards/recurringApi';
import Amount from './Amount';
import { dayLabel } from './labels';
import EndedPlans from './EndedPlans';
import RecurringIcon from './RecurringIcon';
import TruthMark from './TruthMark';
import { frequencyLabel, remainingTotals } from './recurringLabels';
import styles from './Recurring.module.css';

/** How far a debt is paid, as a share 0 to 100 and in words: installments done of the total, else the part of the amount owed that is repaid; null when neither is known. */
function progressOf(row: Recurring, lang: 'ru' | 'en', r: ReturnType<typeof useDashboardLang>['t']['money']['rec']): { percent: number; words: string } | null {
  if (row.totalInstallments && row.totalInstallments > 0) {
    const total = row.totalInstallments;
    const done = Math.min(row.completedInstallments ?? 0, total);
    const scheduled = Math.min(row.scheduledInstallments ?? done, total);
    // What the bank confirmed is told apart from what the schedule alone says.
    const words = scheduled > done ? fill(done > 0 ? r.scheduleProgress : r.scheduleProgressNone, { scheduled, total, done }) : fill(r.confirmedOfTotal, { done, total });
    return { percent: Math.round((scheduled / total) * 100), words };
  }
  if (row.totalOwed && row.totalOwed > 0 && row.remainingBalance !== null) {
    const paid = Math.max(0, Math.min(row.totalOwed, row.totalOwed - row.remainingBalance));
    return { percent: Math.round((paid / row.totalOwed) * 100), words: fill(r.repaidOf, { paid: formatMinor(paid, row.currency, lang), total: formatMinor(row.totalOwed, row.currency, lang) }) };
  }
  return null;
}

const DebtCard: React.FC<{ row: Recurring; mode: MoneyDisplay }> = ({ row, mode }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const progress = progressOf(row, lang, r);
  return (
    <li className={styles.debt}>
      <div className={styles.debtTop}>
        <RecurringIcon name={row.name} iconUrl={row.iconUrl} color={row.color} />
        <span className={styles.dueMain}>
          <strong className={styles.debtName}>{row.name}</strong>
          <span className={styles.note}>{[row.creditor ? fill(r.creditor, { name: row.creditor }) : '', frequencyLabel(row, r)].filter(Boolean).join(' · ')}</span>
        </span>
      </div>
      {row.remainingBalance !== null && (
        <div className={styles.debtLeft}>
          <span className={styles.note}>{r.remaining}</span>
          <strong className={styles.debtAmount}>
            <Amount amount={row.remainingBalance} currency={row.currency} display={row.displayRemaining} mode={mode} />
          </strong>
        </div>
      )}
      {progress && (
        <>
          <div aria-hidden="true" className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${progress.percent}%` }} />
          </div>
          <span className={styles.note}>{progress.words}</span>
        </>
      )}
      <span className={styles.note}>
        {row.nextDate ? (
          <>
            {fill(r.nextPayment, { date: dayLabel(row.nextDate, lang) })} · <Amount amount={row.amount} currency={row.currency} display={row.display} mode={mode} />
          </>
        ) : (
          r.noNextDate
        )}
      </span>
      <TruthMark evidence={row.evidence} />
    </li>
  );
};

/** The debts: collapsed to one summary row (how many, how much is left), the cards one click away. */
const MoneyDebts: React.FC<{ rows: readonly Recurring[]; ended: readonly Recurring[]; mode: MoneyDisplay }> = ({ rows, ended, mode }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const [open, setOpen] = useState(false);
  const totals = remainingTotals(rows, mode);
  const amount = totals.map((total) => `${total.approx ? '≈ ' : ''}${formatMinor(total.amount, total.currency, lang)}`).join(' · ');
  return (
    <>
      {rows.length > 0 && (
      <div className={styles.debtSummary}>
        <span className={styles.debtSummaryText}>{rows.length === 0 ? '' : totals.length > 0 ? fill(r.debtsSummary, { n: rows.length, amount }) : String(rows.length)}</span>
        <button type="button" className={styles.more} aria-expanded={open} aria-controls="money-debts-list" onClick={() => setOpen((on) => !on)}>
          {open ? r.debtsHide : r.debtsShow}
        </button>
      </div>
      )}
      {open && rows.length > 0 && (
        <ul id="money-debts-list" className={styles.debtList}>
          {rows.map((row) => (
            <DebtCard key={row.id} row={row} mode={mode} />
          ))}
        </ul>
      )}
      <EndedPlans rows={ended} />
    </>
  );
};

export default MoneyDebts;
