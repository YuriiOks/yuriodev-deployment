import { describe, expect, it } from 'vitest';
import type { LiveEvent } from './liveApi';
import { resolveNext } from './nextEvents';

const now = new Date('2026-11-24T08:00:00Z');
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 24, hour, minute)).toISOString();
const ev = (id: string, space: LiveEvent['space'], title: string, start: string, end: string): LiveEvent => ({ id, space, title, startsAt: start, endsAt: end, busyOnly: false });
const names = { 'work-1': 'Acme', 'work-2': 'Globex' };

describe('resolveNext', () => {
  const standup = { title: 'Stand-up (Acme)', startsAt: at(9, 15) };
  const events = [
    ev('copy', 'personal', 'Stand-up (Acme)', at(9, 15), at(9, 30)),
    ev('gym', 'personal', 'Gym', at(18), at(19)),
  ];

  it('drops a personal copy of a work meeting as the personal strip and shows the personal space\'s own next event', () => {
    expect(resolveNext('personal', standup, events, now, names)).toEqual({ title: 'Gym', startsAt: at(18) });
  });

  it('gives that meeting to the work space it is tagged with, even when the server\'s next for it is later', () => {
    const later = { title: 'Planning', startsAt: at(14) };
    expect(resolveNext('work-1', later, events, now, names)).toEqual({ title: 'Stand-up (Acme)', startsAt: at(9, 15) });
  });

  it('shows nothing for personal when the copy was its only event', () => {
    expect(resolveNext('personal', standup, [events[0]], now, names)).toBeNull();
  });

  it('keeps the server\'s answer when it is not among the events (further away), or when the list could not be read', () => {
    const far = { title: 'Dentist', startsAt: '2026-12-30T10:00:00Z' };
    expect(resolveNext('personal', far, events, now, names)).toEqual({ title: 'Gym', startsAt: at(18) });
    expect(resolveNext('personal', far, [], now, names)).toEqual(far);
    expect(resolveNext('personal', standup, null, now, names)).toEqual(standup);
  });

  it('keeps a genuine personal event the server names, a work meeting for its own space, and leaves out past and busy-only events', () => {
    const gym = { title: 'Gym', startsAt: at(18) };
    expect(resolveNext('personal', gym, events, now, names)).toEqual(gym);
    const real = [ev('w', 'work-1', 'Review', at(10), at(11))];
    expect(resolveNext('work-1', { title: 'Review', startsAt: at(10) }, real, now, names)).toEqual({ title: 'Review', startsAt: at(10) });
    const past = [ev('p', 'personal', 'Breakfast', at(6), at(7)), { ...ev('b', 'personal', 'Focus', at(9), at(10)), busyOnly: true }];
    expect(resolveNext('personal', null, past, now, names)).toBeNull();
  });
});
