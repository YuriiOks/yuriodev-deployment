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

/** Saturday or Sunday. */
export function isWeekend(iso: string): boolean {
  return weekdayIndex(iso) >= 5;
}

/** The date itself on a working day; on a weekend, the Monday after it. */
export function nearestWorkday(iso: string): string {
  return isWeekend(iso) ? addDays(iso, 7 - weekdayIndex(iso)) : iso;
}

/** One day forward (1) or back (-1), skipping Saturday and Sunday when `workdaysOnly`. */
export function stepDay(iso: string, direction: 1 | -1, workdaysOnly = false): string {
  let next = addDays(iso, direction);
  if (workdaysOnly) while (isWeekend(next)) next = addDays(next, direction);
  return next;
}

/** The dates of the week that contains `iso`, Monday first: seven, or the five working days. */
export function weekDates(iso: string, workdaysOnly = false): string[] {
  const monday = weekStart(iso);
  return Array.from({ length: workdaysOnly ? 5 : 7 }, (_, i) => addDays(monday, i));
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
 * A month as full weeks, Monday first (Monday to Friday with `workdaysOnly`): the days before the
 * 1st and after the last day come from the neighbouring months and are marked `inMonth: false`.
 */
export function monthMatrix(year: number, month: number, workdaysOnly = false): MonthDay[][] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const offset = weekdayIndex(first);
  const weeks = Math.ceil((offset + daysInMonth(year, month)) / 7);
  const start = addDays(first, -offset);
  const columns = workdaysOnly ? 5 : 7;
  const matrix = Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: columns }, (_, day) => {
      const date = addDays(start, week * 7 + day);
      const { year: y, month: m } = parts(date);
      return { date, inMonth: y === year && m === month };
    }),
  );
  // With only the working days, a week none of whose working days is in the month (a month that
  // starts or ends on a weekend) is not shown.
  return workdaysOnly ? matrix.filter((week) => week.some((day) => day.inMonth)) : matrix;
}

/** Items grouped by their `date`, each day's items in their original order. */
export function groupByDate<T extends { readonly date: string }>(items: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.date, [...(groups.get(item.date) ?? []), item]);
  return groups;
}
