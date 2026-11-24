import type { Converted } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import { fill } from '../../../services/dashboards/calendarLabels';
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
export function dayHeading(iso: string, daysUntil: number, lang: string, r: RecurringStrings, overdue = false): string {
  // Already due and not seen paid: it is late, not "today" (the server lists it first, with a negative day count).
  if (overdue || daysUntil < 0) return fill(r.overdueSince, { date: new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(momentOf(iso)) });
  if (daysUntil === 0) return r.today;
  if (daysUntil === 1) return r.tomorrow;
  return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T12:00:00`));
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

/** What is still owed across the debts, as one figure per currency (in pounds mode the converted figure where the server has one, marked "≈"). */
export function remainingTotals(rows: readonly Recurring[], mode: MoneyDisplay): { amount: number; currency: string; approx: boolean }[] {
  const totals = new Map<string, { amount: number; approx: boolean }>();
  for (const row of rows) {
    if (row.remainingBalance === null) continue;
    const useDisplay = mode === 'base' && row.displayRemaining !== null && row.displayRemaining.currency !== row.currency;
    const code = useDisplay && row.displayRemaining ? row.displayRemaining.currency : row.currency;
    const amount = useDisplay && row.displayRemaining ? row.displayRemaining.amount : row.remainingBalance;
    const entry = totals.get(code) ?? { amount: 0, approx: false };
    totals.set(code, { amount: entry.amount + amount, approx: entry.approx || useDisplay });
  }
  return [...totals.entries()].map(([currency, entry]) => ({ currency, ...entry }));
}
