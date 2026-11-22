import { addDays, dayOfMonth, monthOf, weekStart } from './calendarDates';
import type { Strings } from './strings';

/** "23 ноября" / "23 November". */
export function dateLabel(iso: string, t: Pick<Strings, 'monthsOf'>): string {
  return `${dayOfMonth(iso)} ${t.monthsOf[monthOf(iso).month - 1]}`;
}

/** The title of a week: "23–29 ноября", or "30 ноября – 6 декабря" when it crosses a month. */
export function weekRangeLabel(iso: string, t: Pick<Strings, 'monthsOf'>): string {
  const first = weekStart(iso);
  const last = addDays(first, 6);
  if (monthOf(first).month === monthOf(last).month) {
    return `${dayOfMonth(first)}–${dayOfMonth(last)} ${t.monthsOf[monthOf(last).month - 1]}`;
  }
  return `${dateLabel(first, t)} – ${dateLabel(last, t)}`;
}

/** The title of a month: "Ноябрь 2026". */
export function monthTitle(iso: string, t: Pick<Strings, 'months'>): string {
  const { year, month } = monthOf(iso);
  return `${t.months[month - 1]} ${year}`;
}

/** "{key}" placeholders of a string filled in. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

/**
 * Time until an event, in whole minutes and never seconds: "in 47 min", "in 1 h 20 min", "in 2 h", and "now"
 * (under a minute, or already started).
 */
export function countdownLabel(
  minutes: number,
  t: Pick<Strings, 'countdownNow' | 'countdownMin' | 'countdownHour' | 'countdownHourMin'>,
): string {
  const total = Math.floor(minutes);
  if (total < 1) return t.countdownNow;
  if (total < 60) return fill(t.countdownMin, { n: total });
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? fill(t.countdownHour, { h }) : fill(t.countdownHourMin, { h, m });
}
