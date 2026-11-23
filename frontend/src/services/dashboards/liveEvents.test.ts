import { describe, expect, it } from 'vitest';
import type { LiveEvent } from './liveApi';
import { FOCUS_NOTE, clampToHours, rangeOf, toCalEvents, withoutCopies } from './liveEvents';
import { liveHero, nextAtLabel } from './liveLabels';
import { localDate, localTime, minutesUntil, splitIso, toOffsetIso } from './liveTime';
import { STRINGS } from './strings';
import type { CalEvent } from './types';

const HOURS = Array.from({ length: 12 }, (_, i) => `${String(i + 9).padStart(2, '0')}:00`);
const local = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();

const live = (id: string, start: [string, string], end: [string, string], extra: Partial<LiveEvent> = {}): LiveEvent => ({
  id,
  space: 'work-1',
  title: `Event ${id}`,
  startsAt: local(...start),
  endsAt: local(...end),
  busyOnly: false,
  ...extra,
});

describe('local time helpers', () => {
  it('reads an ISO timestamp as the browser\'s local date and time', () => {
    const iso = local('2026-11-24', '10:30');
    expect(splitIso(iso)).toEqual({ date: '2026-11-24', time: '10:30' });
    expect(splitIso('nope')).toBeNull();
    expect(localDate(new Date(2026, 0, 5, 1, 2))).toBe('2026-01-05');
    expect(localTime(new Date(2026, 0, 5, 1, 2))).toBe('01:02');
  });

  it('writes a local date and time as ISO 8601 with an offset, and it reads back the same', () => {
    const iso = toOffsetIso('2026-11-24', '10:00');
    expect(iso).toMatch(/^2026-11-24T10:00:00[+-]\d{2}:\d{2}$/);
    expect(splitIso(iso)).toEqual({ date: '2026-11-24', time: '10:00' });
  });

  it('counts whole minutes until a moment (negative once passed)', () => {
    const now = new Date(2026, 10, 23, 9, 0, 30);
    expect(minutesUntil(new Date(2026, 10, 23, 9, 47, 0).toISOString(), now)).toBe(46);
    expect(minutesUntil(new Date(2026, 10, 23, 8, 0, 0).toISOString(), now)).toBeLessThan(0);
    expect(minutesUntil('x', now)).toBe(0);
  });
});

describe('toCalEvents', () => {
  it('puts an event on the local day it starts, with its times', () => {
    const [event] = toCalEvents([live('a', ['2026-11-24', '10:00'], ['2026-11-24', '11:15'])]);
    expect(event).toMatchObject({ id: 'a', date: '2026-11-24', start: '10:00', end: '11:15', space: 'work-1', title: { ru: 'Event a', en: 'Event a' } });
    expect(event.note).toBeUndefined();
  });

  it('marks a busy-only event as Focus time, in both languages', () => {
    const [event] = toCalEvents([live('b', ['2026-11-24', '10:00'], ['2026-11-24', '11:00'], { busyOnly: true })]);
    expect(event.note).toEqual(FOCUS_NOTE);
    expect(FOCUS_NOTE).toEqual({ ru: 'Фокус-время', en: 'Focus time' });
  });

  it('ends an event that runs past midnight at 23:59, and drops one with unreadable times', () => {
    const [late] = toCalEvents([live('c', ['2026-11-24', '22:00'], ['2026-11-25', '01:00'])]);
    expect(late.end).toBe('23:59');
    expect(toCalEvents([{ ...live('d', ['2026-11-24', '10:00'], ['2026-11-24', '11:00']), startsAt: 'x' }])).toEqual([]);
  });
});

describe('withoutCopies', () => {
  const slot: [[string, string], [string, string]] = [['2026-11-24', '09:15'], ['2026-11-24', '09:30']];

  it('drops a personal copy of a work meeting and keeps the work one', () => {
    const kept = withoutCopies([live('work', ...slot), live('copy', ...slot, { space: 'personal' })]);
    expect(kept.map((event) => event.id)).toEqual(['work']);
  });

  it('keeps a personal event that only overlaps a work one, and one with no work twin', () => {
    const kept = withoutCopies([
      live('work', ...slot),
      live('overlap', ['2026-11-24', '09:15'], ['2026-11-24', '10:00'], { space: 'personal' }),
      live('alone', ['2026-11-24', '12:00'], ['2026-11-24', '12:15'], { space: 'personal' }),
    ]);
    expect(kept.map((event) => event.id)).toEqual(['work', 'overlap', 'alone']);
  });

  it('drops a cancelled meeting', () => {
    expect(withoutCopies([live('gone', ...slot, { title: 'Canceled: 1:1' }), live('off', ...slot, { title: 'Cancelled: sync' })])).toEqual([]);
  });
});

describe('clampToHours', () => {
  const cal = (id: string, start: string, end: string): CalEvent => ({ id, date: '2026-11-24', start, end, title: { ru: id, en: id }, space: 'personal' });

  it('cuts an event to the 09:00 to 21:00 window and leaves one inside it alone', () => {
    expect(clampToHours([cal('a', '08:00', '10:00'), cal('b', '20:30', '23:00'), cal('c', '10:00', '11:00')], HOURS).map((e) => `${e.id} ${e.start}-${e.end}`)).toEqual([
      'a 09:00-10:00',
      'b 20:30-21:00',
      'c 10:00-11:00',
    ]);
  });

  it('leaves out an event entirely outside it', () => {
    expect(clampToHours([cal('x', '06:00', '08:30'), cal('y', '21:00', '22:00'), cal('z', '07:00', '09:00')], HOURS)).toEqual([]);
  });
});

describe('rangeOf', () => {
  it('is the first and the last date, whatever the order', () => {
    expect(rangeOf(['2026-11-25', '2026-11-23', '2026-11-29'])).toEqual({ from: '2026-11-23', to: '2026-11-29' });
  });
});

describe('the strip and the entrance for a real event', () => {
  const now = new Date(2026, 10, 23, 9, 0, 0);

  it('shows only the time for today, and the date in words for another day', () => {
    expect(nextAtLabel(local('2026-11-23', '18:00'), now, STRINGS.en)).toEqual({ at: '18:00' });
    expect(nextAtLabel(local('2026-11-24', '09:30'), now, STRINGS.en)).toEqual({ date: '24 November', at: '09:30' });
    expect(nextAtLabel(local('2026-11-24', '09:30'), now, STRINGS.ru)).toEqual({ date: '24 ноября', at: '09:30' });
  });

  it('builds a hero with whole minutes, no Join and no "then"', () => {
    const hero = liveHero({ title: 'Stand-up', startsAt: local('2026-11-23', '09:47') }, now, STRINGS.en);
    expect(hero).toMatchObject({ at: '09:47', title: { en: 'Stand-up' }, minutesLeft: 47, day: [] });
    expect(hero.join).toBeUndefined();
  });
});
