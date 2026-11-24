import React, { useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import { formatMinor } from '../../../services/dashboards/money';
import { readDebtsOpen, writeDebtsOpen, type MoneyDisplay } from '../../../services/dashboards/preferences';
import type { Recurring } from '../../../services/dashboards/recurringApi';
import type { RecurringStrings } from '../../../services/dashboards/recurringStrings';
import Amount from './Amount';
import EndedPlans from './EndedPlans';
import RecurringIcon from './RecurringIcon';
import TruthMark from './TruthMark';
import { dayLabel } from './labels';
import { frequencyLabel, remainingOf, remainingSummary, todayIso } from './recurringLabels';
import styles from './Recurring.module.css';

/** A share 0 to 100 that never reads 100 while something is left, and never 0 once something is paid (the number is for the words, the fill has its own minimum). */
function share(part: number, whole: number): number {
  if (whole <= 0 || part <= 0) return 0;
  if (part >= whole) return 100;
  return Math.max(1, Math.min(99, Math.floor((part / whole) * 100)));
}

interface Progress {
  /** What is confirmed, 0 to 100. */
  readonly confirmed: number;
  /** What the schedule alone adds on top, 0 to 100 (installments passed by their dates and never seen in a line). */
  readonly assumed: number;
  readonly words: string;
  readonly note: string | null;
}

/**
 * How far a debt is paid: installments (what the bank confirmed, and what the schedule alone adds), else the part of the amount owed
 * that is repaid, from the display figures with "≈" in pounds mode; null when neither is known.
 */
function progressOf(row: Recurring, mode: MoneyDisplay, lang: 'ru' | 'en', r: RecurringStrings): Progress | null {
  if (row.totalInstallments && row.totalInstallments > 0) {
    const total = row.totalInstallments;
    const done = Math.min(row.completedInstallments ?? 0, total);
    // A plan the schedule cannot work out is not drawn as a confident figure: only what is confirmed, and the word for it.
    const unclear = row.scheduleState === 'unknown';
    const scheduled = unclear ? done : Math.min(row.scheduledInstallments ?? done, total);
    const confirmed = share(done, total);
    const assumed = Math.max(0, share(scheduled, total) - confirmed);
    const words = scheduled > done ? fill(done > 0 ? r.scheduleProgress : r.scheduleProgressNone, { scheduled, total, done }) : fill(r.confirmedOfTotal, { done, total });
    return { confirmed, assumed, words, note: unclear ? r.scheduleUnclear : null };
  }
  if (row.totalOwed && row.totalOwed > 0 && row.remainingBalance !== null) {
    if (row.remainingBalance > row.totalOwed) return { confirmed: 0, assumed: 0, words: r.aboveOriginal, note: null };
    const paid = row.totalOwed - row.remainingBalance;
    const shown = mode === 'base' && row.displayTotalOwed && row.displayRemaining && row.displayTotalOwed.currency === row.displayRemaining.currency;
    const words = shown
      ? `≈ ${fill(r.repaidOf, { paid: formatMinor(Math.max(0, row.displayTotalOwed!.amount - row.displayRemaining!.amount), row.displayTotalOwed!.currency, lang), total: formatMinor(row.displayTotalOwed!.amount, row.displayTotalOwed!.currency, lang) })}`
      : fill(r.repaidOf, { paid: formatMinor(paid, row.currency, lang), total: formatMinor(row.totalOwed, row.currency, lang) });
    return { confirmed: share(paid, row.totalOwed), assumed: 0, words, note: null };
  }
  return null;
}

const DebtCard: React.FC<{ row: Recurring; mode: MoneyDisplay }> = ({ row, mode }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const progress = progressOf(row, mode, lang, r);
  const left = remainingOf(row);
  const late = row.nextDate !== null && row.nextDate < todayIso();
  const evidence = row.evidence;
  return (
    <li className={styles.debt}>
      <div className={styles.debtTop}>
        <RecurringIcon name={row.name} iconUrl={row.iconUrl} color={row.color} />
        <span className={styles.dueMain}>
          <strong className={styles.debtName}>{row.name}</strong>
          <span className={styles.note}>{[row.creditor ? fill(r.creditor, { name: row.creditor }) : '', frequencyLabel(row, r)].filter(Boolean).join(' · ')}</span>
        </span>
      </div>
      {left && (
        <div className={styles.debtLeft}>
          <span className={styles.note}>
            {r.remaining}
            {left.estimate && ` (${r.estimateMark})`}
          </span>
          <strong className={styles.debtAmount}>
            <Amount amount={left.amount} currency={row.currency} display={left.display} mode={mode} />
          </strong>
        </div>
      )}
      {left && !left.estimate && row.assumedInstallments > 0 && row.scheduledRemainingBalance !== null && (
        <span className={styles.note}>{fill(r.scheduledRemaining, { amount: formatMinor(row.scheduledRemainingBalance, row.currency, lang) })}</span>
      )}
      {progress && (
        <>
          <div aria-hidden="true" className={styles.bar}>
            {progress.confirmed > 0 && <div className={styles.barFill} style={{ width: `${progress.confirmed}%` }} />}
            {progress.assumed > 0 && <div className={styles.barAssumed} style={{ width: `${progress.assumed}%` }} />}
          </div>
          <span className={styles.note}>{progress.words}</span>
          {progress.note && <span className={styles.note}>{progress.note}</span>}
        </>
      )}
      <span className={styles.note} data-late={late ? 'true' : undefined}>
        {row.nextDate ? (
          <>
            {late ? fill(r.wasDue, { date: dayLabel(row.nextDate, lang) }) : fill(r.nextPayment, { date: dayLabel(row.nextDate, lang) })} · <Amount amount={row.amount} currency={row.currency} display={row.display} mode={mode} />
          </>
        ) : (
          r.noNextDate
        )}
      </span>
      <TruthMark evidence={evidence} />
      {evidence && evidence.checked > 0 && <span className={styles.note}>{fill(r.seenOf, { m: evidence.matchedOfLast, c: evidence.checked })}</span>}
    </li>
  );
};

/**
 * The debts: collapsed (and remembered) to one summary row (how many, how much is left, and when the next payment is), the cards one click
 * away. A figure worked out here is marked an estimate, and a total that leaves some debts out says how many it covers.
 */
const MoneyDebts: React.FC<{ rows: readonly Recurring[]; ended: readonly Recurring[]; mode: MoneyDisplay }> = ({ rows, ended, mode }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const [open, setOpen] = useState(readDebtsOpen);
  const summary = remainingSummary(rows, mode);
  const amount = summary.totals.map((total) => `${total.approx || summary.estimate ? '≈ ' : ''}${formatMinor(total.amount, total.currency, lang)}`).join(' · ');
  const soonest = rows.find((row) => row.nextDate !== null);
  const toggle = () => {
    writeDebtsOpen(!open);
    setOpen(!open);
  };
  return (
    <>
      {rows.length > 0 && (
        <div className={styles.debtSummary}>
          <span className={styles.debtSummaryText}>
            {summary.totals.length > 0 ? fill(r.debtsSummary, { n: rows.length, amount }) : String(rows.length)}
            {summary.known < rows.length && ` · ${fill(r.debtsKnown, { known: summary.known, n: rows.length })}`}
            {soonest?.nextDate && ` · ${fill(r.debtsNextSoonest, { date: dayLabel(soonest.nextDate, lang), amount: formatMinor(soonest.amount, soonest.currency, lang) })}`}
          </span>
          <button type="button" className={styles.more} aria-expanded={open} aria-controls="money-debts-list" onClick={toggle}>
            {open ? r.debtsHide : r.debtsShow}
          </button>
        </div>
      )}
      {rows.length > 0 && (
        <ul id="money-debts-list" className={styles.debtList} hidden={!open}>
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
