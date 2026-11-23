import type { LiveEvent } from './liveApi';
import { localDate, splitIso } from './liveTime';
import type { CalEvent, Localized } from './types';
import { toMinutes } from './weekLayout';

/** The note of an event another space shows only as busy time. */
export const FOCUS_NOTE: Localized = { ru: 'Фокус-время', en: 'Focus time' };

const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const CANCELLED = /^cancel{1,2}ed:/i;

/**
 * Leaves out what would only be noise on the grid: a meeting its organiser cancelled (the work calendar keeps it,
 * titled "Canceled: ..."), and a personal event that is a copy of a work meeting, which is one that starts and
 * ends at exactly the same moments as an event of a work space. The work event is the one that stays.
 */
export function withoutCopies(events: readonly LiveEvent[]): LiveEvent[] {
  const kept = events.filter((event) => !CANCELLED.test(event.title));
  const work = new Set(kept.filter((event) => event.space !== 'personal').map((event) => `${Date.parse(event.startsAt)}|${Date.parse(event.endsAt)}`));
  return kept.filter((event) => event.space !== 'personal' || !work.has(`${Date.parse(event.startsAt)}|${Date.parse(event.endsAt)}`));
}

/**
 * The calendar's events from the API's: one block per event, on the local day it starts, ending at the end time
 * of that day (an event that runs past midnight ends at 23:59). An event whose times cannot be read is dropped.
 */
export function toCalEvents(events: readonly LiveEvent[]): CalEvent[] {
  return withoutCopies(events).flatMap((event) => {
    const start = splitIso(event.startsAt);
    const end = splitIso(event.endsAt);
    if (!start || !end) return [];
    const sameDay = end.date === start.date;
    return [
      {
        id: event.id,
        date: start.date,
        start: start.time,
        end: sameDay ? end.time : '23:59',
        title: { ru: event.title, en: event.title },
        space: event.space,
        ...(event.busyOnly ? { note: FOCUS_NOTE } : {}),
      },
    ];
  });
}

/**
 * Fits events into the week grid's hours ("HH:00" rows): an event is cut to the window, and one entirely outside
 * it is left out (the month view still lists it).
 */
export function clampToHours(events: readonly CalEvent[], hours: readonly string[]): CalEvent[] {
  const first = toMinutes(hours[0]);
  const last = toMinutes(hours[hours.length - 1]) + 60;
  return events.flatMap((event) => {
    const start = toMinutes(event.start);
    const end = toMinutes(event.end);
    if (end <= first || start >= last) return [];
    return [{ ...event, start: hhmm(Math.max(start, first)), end: hhmm(Math.min(end, last)) }];
  });
}

/** The first and last date of what the calendar shows, as the API's `from` and `to`. */
export function rangeOf(dates: readonly string[]): { from: string; to: string } {
  const sorted = [...dates].sort();
  return { from: sorted[0] ?? localDate(new Date()), to: sorted[sorted.length - 1] ?? localDate(new Date()) };
}
