/*
 * Calendar dates as "YYYY-MM-DD" strings, worked out in UTC so the time zone
 * and daylight saving never move a day. Weeks start on Monday.
 */

const DAY_MS = 86_400_000;

function parts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

function toMs(iso: string): number {
  const { year, month, day } = parts(iso);
  return Date.UTC(year, month - 1, day);
}

function fromMs(ms: number): string {
  const date = new Date(ms);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${mm}-${dd}`;
}

export function addDays(iso: string, days: number): string {
  return fromMs(toMs(iso) + days * DAY_MS);
}

/** 0 for Monday up to 6 for Sunday. */
export function weekdayIndex(iso: string): number {
  return (new Date(toMs(iso)).getUTCDay() + 6) % 7;
}

/** The Monday of the week that contains `iso`. */
export function weekStart(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

/** The seven dates of the week that contains `iso`, Monday first. */
export function weekDates(iso: string): string[] {
  const monday = weekStart(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The year and month (1-12) of a date. */
export function monthOf(iso: string): { year: number; month: number } {
  const { year, month } = parts(iso);
  return { year, month };
}

/** The first day of the month `delta` months from the one that contains `iso`. */
export function addMonths(iso: string, delta: number): string {
  const { year, month } = parts(iso);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The day number in the month (1-31). */
export function dayOfMonth(iso: string): number {
  return parts(iso).day;
}

export interface MonthDay {
  readonly date: string;
  /** False for the leading and trailing days of the neighbouring months. */
  readonly inMonth: boolean;
}

/**
 * A month as full weeks, Monday first: the days before the 1st and after the
 * last day come from the neighbouring months and are marked `inMonth: false`.
 */
export function monthMatrix(year: number, month: number): MonthDay[][] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const offset = weekdayIndex(first);
  const weeks = Math.ceil((offset + daysInMonth(year, month)) / 7);
  const start = addDays(first, -offset);
  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const date = addDays(start, week * 7 + day);
      const { year: y, month: m } = parts(date);
      return { date, inMonth: y === year && m === month };
    }),
  );
}

/** Items grouped by their `date`, each day's items in their original order. */
export function groupByDate<T extends { readonly date: string }>(items: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.date, [...(groups.get(item.date) ?? []), item]);
  return groups;
}
