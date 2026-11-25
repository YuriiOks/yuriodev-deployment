/**
 * The moment a date text stands for. A date alone ("2026-12-02") is a calendar day, not an instant: it is taken at local noon, so it shows
 * as that day wherever the viewer is (read as UTC midnight it would show as the day before west of Greenwich). Anything with a time keeps it.
 */
export function momentOf(iso: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
}

import { capitalized, formatDate, stampLabel } from '../../../services/dashboards/dateFormat';

/** A date alone, in the page's language. */
export function dayLabel(iso: string | null, lang: string): string {
  if (!iso || Number.isNaN(momentOf(iso).getTime())) return '';
  return formatDate(momentOf(iso), lang, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The time of day of a moment (24-hour), or '' when it has none to tell. */
export function timeLabel(iso: string | null, lang: string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return formatDate(new Date(iso), lang, { hour: '2-digit', minute: '2-digit' });
}

/** A day's heading in a list ("Mon 24 Nov"; with the year when it is not this one). */
export function dayTitle(iso: string, lang: string, now: Date = new Date()): string {
  const date = momentOf(iso);
  if (Number.isNaN(date.getTime())) return '';
  const month = formatDate(date, lang, { day: 'numeric', month: 'short', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
  return `${formatDate(date, lang, { weekday: 'short' })} ${month}`;
}

/** The calendar day a moment falls on, in the viewer's own time zone, as YYYY-MM-DD. */
export function localDay(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A moment as a short date and time on a 24-hour clock in the page's language (a row of a list: it never turns into "today"). */
export function whenLabel(iso: string | null, lang: string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return formatDate(new Date(iso), lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** When something was last read, as a stamp ("today 15:32", "yesterday 08:16", else the date), for the freshness lines. */
export function freshLabel(iso: string | null, lang: string, now: Date = new Date()): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return stampLabel(new Date(iso), lang === 'ru' ? 'ru' : 'en', now);
}

/** "2026-11" as a month name in the page's language ("ноябрь", "November"). */
export function monthName(month: string, lang: string): string {
  const date = new Date(`${month}-01T12:00:00`);
  return Number.isNaN(date.getTime()) ? month : formatDate(date, lang, { month: 'long' });
}

/** The same month name as the start of a heading or a sentence (capitalised). */
export function monthTitle(month: string, lang: string): string {
  return capitalized(monthName(month, lang));
}
