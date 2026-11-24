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
export function dayHeading(iso: string, daysUntil: number, lang: string, r: RecurringStrings): string {
  if (daysUntil <= 0) return r.today;
  if (daysUntil === 1) return r.tomorrow;
  return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T12:00:00`));
}
