import { toMinutes } from './weekLayout';

/**
 * Where the "now" line sits in a week grid, in hours below the grid's top, or null when the time of day is outside
 * the grid (the calendar shows 09:00 to 21:00 only). `hours` are the grid's rows as "HH:00".
 */
export function nowOffsetHours(now: Date, hours: readonly string[]): number | null {
  const first = toMinutes(hours[0]);
  const last = toMinutes(hours[hours.length - 1]) + 60;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < first || minutes >= last) return null;
  return (minutes - first) / 60;
}
