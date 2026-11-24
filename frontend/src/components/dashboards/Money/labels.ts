/** A date alone, in the page's language. */
export function dayLabel(iso: string | null, lang: string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
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
