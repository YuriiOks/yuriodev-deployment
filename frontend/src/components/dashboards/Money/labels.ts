/**
 * The moment a date text stands for. A date alone ("2026-12-02") is a calendar day, not an instant: it is taken at local noon, so it shows
 * as that day wherever the viewer is (read as UTC midnight it would show as the day before west of Greenwich). Anything with a time keeps it.
 */
export function momentOf(iso: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
}

/** A date alone, in the page's language. */
export function dayLabel(iso: string | null, lang: string): string {
  if (!iso || Number.isNaN(momentOf(iso).getTime())) return '';
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(momentOf(iso));
}

/** When something was last read, as a short date and time in the page's language. */
export function whenLabel(iso: string | null, lang: string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** "2026-11" as a month name in the page's language ("ноябрь", "November"). */
export function monthName(month: string, lang: string): string {
  const date = new Date(`${month}-01T12:00:00`);
  return Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat(lang, { month: 'long' }).format(date);
}
