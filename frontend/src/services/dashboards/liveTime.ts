/*
 * Dates and times for the live data. The API speaks ISO 8601 with an offset; the calendar and the task lists speak
 * the browser's local "YYYY-MM-DD" and "HH:MM", so every conversion happens here, in one place.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/** "YYYY-MM-DD" of `date` in the browser's time zone. */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "HH:MM" of `date` in the browser's time zone. */
export function localTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The local date and time of an ISO timestamp, or null when it is not one. */
export function splitIso(iso: string): { date: string; time: string } | null {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return null;
  return { date: localDate(moment), time: localTime(moment) };
}

/** A local date and time as ISO 8601 with the browser's offset ("2026-11-24T10:00:00+01:00"). */
export function toOffsetIso(date: string, time: string): string {
  const moment = new Date(`${date}T${time}:00`);
  const offset = -moment.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${date}T${time}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Whole minutes from `now` until `iso` (negative once it has passed); 0 when `iso` is not a timestamp. */
export function minutesUntil(iso: string, now: Date): number {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return 0;
  return Math.floor((at - now.getTime()) / 60000);
}
