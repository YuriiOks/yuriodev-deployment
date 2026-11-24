import type { Converted } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import { fill } from '../../../services/dashboards/calendarLabels';
import { momentOf } from './labels';
import type { Recurring } from '../../../services/dashboards/recurringApi';
import type { RecurringStrings } from '../../../services/dashboards/recurringStrings';

/** An amount as plain text: in pounds mode a converted figure is marked "≈" (the original is told beside it where the page has room), else the original. */
export function amountText(amount: number, code: string, display: Converted | null, mode: MoneyDisplay, lang: string): string {
  if (mode === 'base' && display && display.currency !== code) return `≈ ${formatMinor(display.amount, display.currency, lang as 'ru' | 'en')}`;
  return formatMinor(amount, code, lang as 'ru' | 'en');
}

/** "today", "tomorrow", "in 3 d". */
export function dueWhen(days: number, r: RecurringStrings): string {
  if (days <= 0) return r.dueWhen.today;
  return days === 1 ? r.dueWhen.tomorrow : fill(r.dueWhen.inDays, { n: days });
}

/** "monthly", or "monthly, every 3" when the interval is more than one. */
export function frequencyLabel(row: Pick<Recurring, 'frequency' | 'frequencyInterval'>, r: RecurringStrings): string {
  const label = r.frequencies[row.frequency];
  return row.frequencyInterval > 1 && row.frequency !== 'once' ? fill(r.everyN, { label, n: row.frequencyInterval }) : label;
}

/** A day's heading in a list of upcoming payments: Today, Tomorrow, then the date. */
export function dayHeading(iso: string, daysUntil: number, lang: string, r: RecurringStrings): string {
  if (daysUntil <= 0) return r.today;
  if (daysUntil === 1) return r.tomorrow;
  return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(momentOf(iso));
}

/** The debts and installment plans among the payments (active ones), the soonest next payment first. */
export function debtsOf(recurring: readonly Recurring[]): Recurring[] {
  return recurring
    .filter((row) => row.isActive && (row.kind === 'debt' || row.isInstallment) && row.scheduleState !== 'ended_by_schedule')
    .sort((a, b) => (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999') || a.name.localeCompare(b.name));
}

/** The plans its own schedule has finished, apart from the rest: debts and installments (`debts`) or every other payment. */
export function endedOf(recurring: readonly Recurring[], debts: boolean): Recurring[] {
  return recurring.filter((row) => row.isActive && row.scheduleState === 'ended_by_schedule' && (row.kind === 'debt' || row.isInstallment) === debts).sort((a, b) => a.name.localeCompare(b.name));
}

/** The windows the upcoming payments can be asked for, in days. */
export const WINDOWS = [14, 30] as const;

/** The local calendar day, as "YYYY-MM-DD" (what a payment's date is compared with). */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export interface Remaining {
  readonly amount: number;
  readonly display: Converted | null;
  /** Worked out here (the installments left times the amount), not a balance on record. */
  readonly estimate: boolean;
}

/** What is left of a debt: the balance on record, else the installments left times the amount (marked as an estimate), else nothing is known. */
export function remainingOf(row: Recurring): Remaining | null {
  if (row.remainingBalance !== null) return { amount: row.remainingBalance, display: row.displayRemaining, estimate: false };
  if (row.totalInstallments && row.totalInstallments > 0) return { amount: Math.max(row.totalInstallments - (row.completedInstallments ?? 0), 0) * row.amount, display: null, estimate: true };
  return null;
}

export interface RemainingSummary {
  readonly totals: { amount: number; currency: string; approx: boolean }[];
  /** How many of the debts have a figure (a balance on record or worked out). */
  readonly known: number;
  /** A figure in the total was worked out, not recorded. */
  readonly estimate: boolean;
}

/** What is still owed across the debts, one figure per currency (in pounds mode the converted figure where the server gave one, marked "≈"), and how many debts it covers. */
export function remainingSummary(rows: readonly Recurring[], mode: MoneyDisplay): RemainingSummary {
  const totals = new Map<string, { amount: number; approx: boolean }>();
  let known = 0;
  let estimate = false;
  for (const row of rows) {
    const left = remainingOf(row);
    if (!left) continue;
    known += 1;
    estimate = estimate || left.estimate;
    const useDisplay = mode === 'base' && left.display !== null && left.display.currency !== row.currency;
    const code = useDisplay && left.display ? left.display.currency : row.currency;
    const amount = useDisplay && left.display ? left.display.amount : left.amount;
    const entry = totals.get(code) ?? { amount: 0, approx: false };
    totals.set(code, { amount: entry.amount + amount, approx: entry.approx || useDisplay });
  }
  return { totals: [...totals.entries()].map(([currency, entry]) => ({ currency, ...entry })), known, estimate };
}
