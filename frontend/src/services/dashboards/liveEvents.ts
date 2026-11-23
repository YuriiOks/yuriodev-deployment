import type { LiveEvent } from './liveApi';
import { localDate, splitIso } from './liveTime';
import type { CalEvent, Localized, SpaceId } from './types';
import { toMinutes } from './weekLayout';

/** The note of an event another space shows only as busy time. */
export const FOCUS_NOTE: Localized = { ru: 'Фокус-время', en: 'Focus time' };

const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const CANCELLED = /^cancel{1,2}ed:/i;

/**
 * Leaves out what would only be noise on the grid: a meeting its organiser cancelled (the work calendar keeps it,
 * titled "Canceled: ..."), and a personal event that is a copy of a work meeting, which is one that starts and
 * ends at exactly the same moments as an event of a work space. The work event is the one that stays. A personal
 * event whose title ends with a work space's name in brackets is that space's too (see `taggedSpace`).
 */
export function withoutCopies(events: readonly LiveEvent[], names: SpaceTags = {}): LiveEvent[] {
  const kept = events.filter((event) => !CANCELLED.test(event.title));
  const fed = new Set(kept.filter((event) => event.space !== 'personal').map((event) => event.space));
  const work = new Set(kept.filter((event) => event.space !== 'personal').map((event) => `${Date.parse(event.startsAt)}|${Date.parse(event.endsAt)}`));
  return kept.flatMap((event) => {
    if (event.space !== 'personal') return [event];
    if (work.has(`${Date.parse(event.startsAt)}|${Date.parse(event.endsAt)}`)) return [];
    const tagged = taggedSpace(event.title, names);
    if (!tagged) return [event];
    // The work space's own calendar is the truth when it has one: the tagged personal entry is a copy, possibly a
    // stale one. A work space with no calendar of its own gets the entry instead.
    return fed.has(tagged) ? [] : [{ ...event, space: tagged }];
  });
}

/** The server's names of the work spaces: a personal event titled "... (<name>)" belongs to that space. */
export type SpaceTags = Readonly<Partial<Record<SpaceId, string>>>;

function taggedSpace(title: string, names: SpaceTags): SpaceId | null {
  const lower = title.trim().toLowerCase();
  for (const space of ['work-1', 'work-2'] as const) {
    const name = names[space]?.trim().toLowerCase();
    if (name && lower.endsWith(`(${name})`)) return space;
  }
  return null;
}

/** The week grid's hours in live mode: the usual ones, started earlier when an event on screen begins before them. */
export function hoursFor(events: readonly CalEvent[], usual: readonly string[]): string[] {
  const first = Math.floor(toMinutes(usual[0]) / 60);
  const earliest = events.reduce((hour, event) => Math.min(hour, Math.floor(toMinutes(event.start) / 60)), first);
  const last = Math.floor(toMinutes(usual[usual.length - 1]) / 60);
  return Array.from({ length: last - earliest + 1 }, (_, i) => `${String(earliest + i).padStart(2, '0')}:00`);
}

/**
 * The calendar's events from the API's: one block per event, on the local day it starts, ending at the end time
 * of that day (an event that runs past midnight ends at 23:59). An event whose times cannot be read is dropped.
 */
export function toCalEvents(events: readonly LiveEvent[], names: SpaceTags = {}): CalEvent[] {
  return withoutCopies(events, names).flatMap((event) => {
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
