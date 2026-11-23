import { dateLabel } from './calendarLabels';
import type { SummaryNext } from './liveApi';
import { localDate, minutesUntil, splitIso } from './liveTime';
import type { Strings } from './strings';
import type { Hero } from './types';

/** When the next event starts: its time (data), and its date in words when it is not today. */
export function nextAtLabel(startsAt: string, now: Date, t: Pick<Strings, 'monthsOf'>): { date?: string; at: string } {
  const parts = splitIso(startsAt);
  if (!parts) return { at: '' };
  return parts.date === localDate(now) ? { at: parts.time } : { date: dateLabel(parts.date, t), at: parts.time };
}

/** The next-event strip's data for a real event (no Join, no "then", no sync line). */
export function liveHero(next: SummaryNext, now: Date, t: Pick<Strings, 'monthsOf'>): Hero {
  return {
    ...nextAtLabel(next.startsAt, now, t),
    title: { ru: next.title, en: next.title },
    minutesLeft: minutesUntil(next.startsAt, now),
    day: [],
    sync: { ru: '', en: '' },
  };
}

/** The nearest of several next events: the earliest start, or null when none of them has one. */
export function nearestNext(next: ReadonlyArray<SummaryNext | null>): SummaryNext | null {
  let nearest: SummaryNext | null = null;
  for (const candidate of next) {
    if (candidate && (nearest === null || Date.parse(candidate.startsAt) < Date.parse(nearest.startsAt))) nearest = candidate;
  }
  return nearest;
}
